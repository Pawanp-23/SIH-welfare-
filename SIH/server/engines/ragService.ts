import { GoogleGenAI } from '@google/genai';

export interface RAGDocumentChunk {
  id: string;
  code: string;
  title: string;
  category: 'fatigue' | 'rest' | 'counseling' | 'privacy' | 'command';
  text: string;
  legalBasis: string;
}

export const RAG_KNOWLEDGE_BASE: RAGDocumentChunk[] = [
  {
    id: 'sop-wel-01',
    code: 'SOP-WEL-01 §1.4',
    title: 'Post-Deployment Rest Cycles & Acclimatization',
    category: 'rest',
    text: 'Personnel completing continuous high-altitude, forward reconnaissance, or border surveillance deployments exceeding 45 days must receive a mandatory 72-hour de-escalation rest window prior to standard duty rotation. Leave authorization must be prioritized for personnel in Watch or Review bands.',
    legalBasis: 'Armed Forces Health & Welfare Regulation 2024, Art. 12'
  },
  {
    id: 'sop-wel-02',
    code: 'SOP-WEL-02 §4.2',
    title: 'Acute Fatigue & Night Shift Governance',
    category: 'fatigue',
    text: 'No uniformed personnel shall be assigned to more than two consecutive night watch shifts without a scheduled 24-hour physiological circadian recovery interval. When an individual logs three consecutive night shifts and sleep is below 5 hours, an immediate 48-hour recovery cycle is mandatory and replacement watch personnel must be coordinated.',
    legalBasis: 'Directorate of Operational Medical Services, Circular 44/2023'
  },
  {
    id: 'sop-wel-03',
    code: 'SOP-WEL-03 §2.1',
    title: 'Voluntary Welfare Counseling Protocol',
    category: 'counseling',
    text: 'Any self-initiated personnel support request or sustained high-risk alert triggers an immediate priority welfare case. The assigned welfare officer must conduct an initial confidential informal inquiry within 24 hours. Medical confidentiality is strictly maintained, and discussions cannot be cited in performance evaluations.',
    legalBasis: 'Force Mental Health & Wellbeing Code §18'
  },
  {
    id: 'sop-wel-04',
    code: 'SOP-WEL-04 §3.0',
    title: 'Non-Punitive Health Information Protections',
    category: 'privacy',
    text: 'Personal wellness check-in responses and AI risk indices are strictly protected under Section 14 Privacy Directives. Disciplinary or promotional decision boards are legally prohibited from subpoenaing, reviewing, or considering subjective stress ratings. All command-level views must enforce k-anonymity (k >= 10).',
    legalBasis: 'Section 14 Privacy Directives for Uniformed Services'
  },
  {
    id: 'sop-wel-05',
    code: 'SOP-WEL-05 §5.3',
    title: 'Unit Workload Rebalancing & Guard Rota Caps',
    category: 'command',
    text: 'When a unit aggregate shows more than 25% of personnel in Watch/Review bands or average duty shifts exceed 11 hours over a 14-day rolling window, Battalion Commanders must enact Roster Level-2 Rebalancing, curtailing non-essential fatigue-inducing tasks and rotating relief detachments.',
    legalBasis: 'Command Readiness & Force Preservation Directive 2025'
  }
];

export class RAGService {
  private geminiClient: GoogleGenAI | null = null;

  private getGemini(): GoogleGenAI | null {
    if (!this.geminiClient && process.env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return this.geminiClient;
  }

  /**
   * Search knowledge base and synthesize policy-grounded recommendation
   */
  public async getEvidenceGroundedGuidance(query: string, riskContext?: string): Promise<{
    answer: string;
    citations: Array<{ code: string; title: string; legalBasis: string }>;
    recommendedInterventions: string[];
  }> {
    const matchingDocs = RAG_KNOWLEDGE_BASE.filter((doc) => {
      const q = query.toLowerCase();
      return (
        doc.text.toLowerCase().includes(q) ||
        doc.title.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q) ||
        doc.code.toLowerCase().includes(q)
      );
    });

    const relevantDocs = matchingDocs.length > 0 ? matchingDocs : RAG_KNOWLEDGE_BASE.slice(0, 3);

    const client = this.getGemini();
    if (client) {
      try {
        const prompt = `You are the SAHARA Evidence-Grounded Welfare Intelligence Assistant.
Your mission is to formulate actionable, clinical, and command-compliant welfare interventions grounded in official Force Regulations and SOPs.

SOP KNOWLEDGE BASE:
${relevantDocs.map((d) => `[${d.code} - ${d.title}]\n${d.text}\nLegal Basis: ${d.legalBasis}`).join('\n\n')}

PERSONNEL CONTEXT:
${riskContext || 'High occupational stress, acute sleep deficit (<4.5h), 3 consecutive night duties, risk score 78.'}

USER QUERY:
${query}

INSTRUCTIONS:
1. Provide a concise, professional 2-3 paragraph guidance note.
2. Directly cite the relevant SOP code (e.g. SOP-WEL-02 §4.2) for every operational recommendation.
3. Formulate 2-3 concrete, actionable welfare steps that a welfare officer or commander can execute immediately.
4. Reinforce the non-punitive privacy protections of Section 14.`;

        const response = await client.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt
        });

        if (response.text) {
          return {
            answer: response.text,
            citations: relevantDocs.map((d) => ({ code: d.code, title: d.title, legalBasis: d.legalBasis })),
            recommendedInterventions: [
              'Mandatory 48-Hour Circadian Rest & Recovery Window (SOP-WEL-02 §4.2)',
              'Immediate Watch Roster Swap & Shift Cap to 8 hours (SOP-WEL-05 §5.3)',
              'Confidential 1-on-1 Welfare Officer Consultation (SOP-WEL-03 §2.1)'
            ]
          };
        }
      } catch (err: any) {
        console.warn('Gemini API call fell back to local synthesis:', err.message);
      }
    }

    // Deterministic fallback if Gemini is unavailable
    return {
      answer: `Based on ${relevantDocs[0].code} (${relevantDocs[0].title}), personnel experiencing acute fatigue or sleep deficit must immediately enter a managed recovery interval. Under ${relevantDocs[0].legalBasis}, the assigned welfare officer is empowered to coordinate watch duty swaps and schedule a confidential welfare interview. All records are protected by non-punitive Section 14 directives.`,
      citations: relevantDocs.map((d) => ({ code: d.code, title: d.title, legalBasis: d.legalBasis })),
      recommendedInterventions: [
        'Mandatory 48-Hour Circadian Rest Window (SOP-WEL-02 §4.2)',
        'Watch Roster Swap & Shift Length Cap (SOP-WEL-05 §5.3)',
        'Confidential Welfare Consultation (SOP-WEL-03 §2.1)'
      ]
    };
  }
}

export const ragService = new RAGService();
