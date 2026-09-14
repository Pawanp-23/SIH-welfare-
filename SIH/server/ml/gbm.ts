/**
 * Gradient-boosted tree inference in pure TypeScript.
 *
 * This traverses the *actual* trees learned by scikit-learn and exported by
 * `ml/train.py`. `npm run ml:verify` asserts that this implementation
 * reproduces sklearn's own predictions to ~1e-13, so what ships in the browser
 * demo is the same function that was evaluated on the held-out cohort.
 *
 * The one subtlety worth knowing: sklearn's tree code demotes the feature
 * matrix to float32 before comparing against split thresholds. A value sitting
 * within a float32 ULP of a split point therefore routes differently in
 * float64. `Math.fround` reproduces that demotion exactly — without it, a
 * handful of predictions per thousand drift by a whole leaf value.
 */

import type { SerializedEnsemble, SerializedTree } from './types.js';

const LEAF = -1;

/** Walk one tree and return its leaf value. */
export function predictTree(tree: SerializedTree, x: Float64Array | number[]): number {
  let node = 0;
  while (tree.children_left[node] !== LEAF) {
    const f = tree.feature[node];
    node =
      Math.fround(x[f]) <= tree.threshold[node]
        ? tree.children_left[node]
        : tree.children_right[node];
  }
  return tree.value[node];
}

/** Raw (link-space) ensemble output: base + lr * Σ tree. */
export function predictRaw(ens: SerializedEnsemble, x: Float64Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < ens.trees.length; i++) sum += predictTree(ens.trees[i], x);
  return ens.base_score + ens.learning_rate * sum;
}

/** Apply the inverse link so the caller gets a probability or a raw value. */
export function predict(ens: SerializedEnsemble, x: Float64Array | number[]): number {
  const raw = predictRaw(ens, x);
  return ens.link === 'logit' ? 1 / (1 + Math.exp(-raw)) : raw;
}

/**
 * Cover-weighted mean leaf value of a tree — the model's output when every
 * feature is unknown. Summed across the ensemble this gives E[f(X)], the base
 * value that a SHAP waterfall starts from.
 */
export function treeExpectedValue(tree: SerializedTree): number {
  const walk = (node: number): number => {
    if (tree.children_left[node] === LEAF) return tree.value[node];
    const l = tree.children_left[node];
    const r = tree.children_right[node];
    const total = tree.cover[node];
    if (total <= 0) return tree.value[node];
    return (tree.cover[l] * walk(l) + tree.cover[r] * walk(r)) / total;
  };
  return walk(0);
}

/** E[f(X)] in raw link space for a whole ensemble. */
export function expectedRaw(ens: SerializedEnsemble): number {
  let sum = 0;
  for (const t of ens.trees) sum += treeExpectedValue(t);
  return ens.base_score + ens.learning_rate * sum;
}

// ---------------------------------------------------------------------------
// Exact TreeSHAP  (Lundberg, Erion & Lee 2019, Algorithm 2)
// ---------------------------------------------------------------------------
//
// Why not "just use feature importances"? Global importance tells a commander
// which features matter on average. A welfare officer looking at one jawan
// needs to know why *this* prediction is what it is. SHAP gives the unique
// attribution satisfying local accuracy (contributions sum exactly to the
// prediction minus the population baseline), missingness and consistency —
// which is what makes the explanation defensible when a decision is challenged.
//
// Complexity is O(TLD²) — with depth-3 trees the inner path is at most 4 long,
// so a full 180-tree explanation costs microseconds.

interface PathElement {
  /** feature index this path element splits on (-1 for the root sentinel) */
  d: number;
  /** fraction of paths that flow through this branch when the feature is absent */
  z: number;
  /** 1 if the branch is on the observed path, else 0 */
  o: number;
  /** Shapley weight accumulator */
  w: number;
}

function newPath(depth: number): PathElement[] {
  const p: PathElement[] = new Array(depth + 2);
  for (let i = 0; i < p.length; i++) p[i] = { d: -1, z: 1, o: 1, w: 0 };
  return p;
}

function copyPath(src: PathElement[], len: number, dst: PathElement[]): void {
  for (let i = 0; i <= len; i++) {
    dst[i].d = src[i].d;
    dst[i].z = src[i].z;
    dst[i].o = src[i].o;
    dst[i].w = src[i].w;
  }
}

// `uniqueDepth` below always means "index of the element just written", which
// is the convention the reference C++ implementation uses. Getting this off by
// one silently produces plausible-looking but wrong attributions, so the
// verifier checks local accuracy rather than eyeballing the numbers.

/** EXTEND: grow the subset path by one element, keeping Shapley weights valid. */
function extendPath(
  path: PathElement[],
  uniqueDepth: number,
  zFraction: number,
  oFraction: number,
  featureIndex: number,
): void {
  path[uniqueDepth].d = featureIndex;
  path[uniqueDepth].z = zFraction;
  path[uniqueDepth].o = oFraction;
  path[uniqueDepth].w = uniqueDepth === 0 ? 1 : 0;

  for (let i = uniqueDepth - 1; i >= 0; i--) {
    path[i + 1].w += (oFraction * path[i].w * (i + 1)) / (uniqueDepth + 1);
    path[i].w = (zFraction * path[i].w * (uniqueDepth - i)) / (uniqueDepth + 1);
  }
}

/** UNWIND: remove element `idx`, undoing its contribution to every weight. */
function unwindPath(path: PathElement[], uniqueDepth: number, idx: number): void {
  const one = path[idx].o;
  const zero = path[idx].z;
  let nextOne = path[uniqueDepth].w;

  for (let i = uniqueDepth - 1; i >= 0; i--) {
    if (one !== 0) {
      const tmp = path[i].w;
      path[i].w = (nextOne * (uniqueDepth + 1)) / ((i + 1) * one);
      nextOne = tmp - (path[i].w * zero * (uniqueDepth - i)) / (uniqueDepth + 1);
    } else {
      path[i].w = (path[i].w * (uniqueDepth + 1)) / (zero * (uniqueDepth - i));
    }
  }

  for (let i = idx; i < uniqueDepth; i++) {
    path[i].d = path[i + 1].d;
    path[i].z = path[i + 1].z;
    path[i].o = path[i + 1].o;
  }
}

/** Σ of the weights the path would have if element `idx` were removed. */
function unwoundPathSum(path: PathElement[], uniqueDepth: number, idx: number): number {
  const one = path[idx].o;
  const zero = path[idx].z;
  let nextOne = path[uniqueDepth].w;
  let total = 0;

  for (let i = uniqueDepth - 1; i >= 0; i--) {
    if (one !== 0) {
      const tmp = (nextOne * (uniqueDepth + 1)) / ((i + 1) * one);
      total += tmp;
      nextOne = path[i].w - (tmp * zero * (uniqueDepth - i)) / (uniqueDepth + 1);
    } else if (zero !== 0) {
      total += path[i].w / zero / ((uniqueDepth - i) / (uniqueDepth + 1));
    }
  }
  return total;
}

function treeShapRecurse(
  tree: SerializedTree,
  x: Float64Array | number[],
  phi: Float64Array,
  node: number,
  parentPath: PathElement[],
  parentDepth: number,
  zFraction: number,
  oFraction: number,
  featureIndex: number,
  scratch: PathElement[][],
  level: number,
): void {
  const path = scratch[level];
  copyPath(parentPath, parentDepth, path);
  extendPath(path, parentDepth, zFraction, oFraction, featureIndex);
  let uniqueDepth = parentDepth;

  if (tree.children_left[node] === LEAF) {
    const leaf = tree.value[node];
    for (let i = 1; i <= uniqueDepth; i++) {
      const w = unwoundPathSum(path, uniqueDepth, i);
      phi[path[i].d] += w * (path[i].o - path[i].z) * leaf;
    }
    return;
  }

  const splitFeature = tree.feature[node];
  const goesLeft = Math.fround(x[splitFeature]) <= tree.threshold[node];
  const hot = goesLeft ? tree.children_left[node] : tree.children_right[node];
  const cold = goesLeft ? tree.children_right[node] : tree.children_left[node];

  let incomingZ = 1;
  let incomingO = 1;

  // If this feature already appears on the path, fold the old occurrence out
  // before adding the new one — otherwise it would be double counted.
  let seenAt = -1;
  for (let i = 0; i <= uniqueDepth; i++) {
    if (path[i].d === splitFeature) {
      seenAt = i;
      break;
    }
  }
  if (seenAt !== -1) {
    incomingZ = path[seenAt].z;
    incomingO = path[seenAt].o;
    unwindPath(path, uniqueDepth, seenAt);
    uniqueDepth -= 1;
  }

  const total = tree.cover[node];
  const hotFraction = total > 0 ? tree.cover[hot] / total : 0;
  const coldFraction = total > 0 ? tree.cover[cold] / total : 0;

  treeShapRecurse(tree, x, phi, hot, path, uniqueDepth + 1,
    incomingZ * hotFraction, incomingO, splitFeature, scratch, level + 1);
  treeShapRecurse(tree, x, phi, cold, path, uniqueDepth + 1,
    incomingZ * coldFraction, 0, splitFeature, scratch, level + 1);
}

/**
 * Exact SHAP values for one ensemble, in raw link space.
 *
 * Guarantee (local accuracy): `expectedRaw(ens) + Σ shap == predictRaw(ens, x)`.
 * `npm run ml:verify` asserts this across the whole held-out set.
 */
export function treeShap(
  ens: SerializedEnsemble,
  x: Float64Array | number[],
  nFeatures: number,
): Float64Array {
  const phi = new Float64Array(nFeatures);
  const cap = ens.max_depth + 4;
  const scratch: PathElement[][] = [];
  for (let d = 0; d <= cap; d++) scratch.push(newPath(cap));
  const root = newPath(cap);

  for (const tree of ens.trees) {
    treeShapRecurse(tree, x, phi, 0, root, 0, 1, 1, -1, scratch, 0);
  }
  for (let i = 0; i < nFeatures; i++) phi[i] *= ens.learning_rate;
  return phi;
}
