# Shows Duvet's notifications on Windows (src/bun/toasts.ts): one toast per JSON line on stdin, {"xml", "tag", "group"},
# under the AUMID in $aumid, which the Bun process puts first. Each toast is answered on stdout by its tag: {"tag"} when
# it showed, {"tag", "error"} when it didn't, and the rest go on; the script ends with its stdin.
$ErrorActionPreference = 'Stop'
# No progress records on stderr ("Preparing modules for first use"), which the Bun process logs, and answers in UTF-8.
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid)
$stdin = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false))
while ($null -ne ($line = $stdin.ReadLine())) {
	$m = $null
	try {
		$m = $line | ConvertFrom-Json
		$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
		$doc.LoadXml($m.xml)
		$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
		$toast.Tag = $m.tag
		$toast.Group = $m.group
		$notifier.Show($toast)
		$answer = @{ tag = $m.tag }
	} catch {
		$answer = @{ tag = $m.tag; error = "$_" }
	}
	[Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress))
	[Console]::Out.Flush()
}
