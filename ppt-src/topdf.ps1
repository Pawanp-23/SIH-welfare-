param([string]$pptx, [string]$pdf)
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open($pptx, $true, $false, $false)
$pres.SaveAs($pdf, 32)   # 32 = ppSaveAsPDF
$pres.Close(); $pp.Quit(); "pdf ok"
