param([string]$pptx, [string]$outdir)
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open($pptx, $true, $false, $false)
New-Item -ItemType Directory -Force $outdir | Out-Null
Get-ChildItem $outdir -Filter *.png | Remove-Item -Force
$i = 1
foreach ($s in $pres.Slides) { $s.Export("$outdir\slide-$i.png", "PNG", 1600, 900); $i++ }
$pres.Close(); $pp.Quit()
Write-Output "rendered $($i-1) slides to $outdir"
