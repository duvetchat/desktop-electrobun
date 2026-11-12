# Shows Duvet's notifications on Windows (src/bun/toasts.ts): one toast per JSON line on stdin, {"xml", "tag", "group"},
# under the AUMID in $aumid, which the Bun process puts first. A toast that fails prints {"error"} and the rest go on;
# the script ends with its stdin.
$ErrorActionPreference = 'Stop'
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid)
$stdin = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false))
while ($null -ne ($line = $stdin.ReadLine())) {
	try {
		$m = $line | ConvertFrom-Json
		$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
		$doc.LoadXml($m.xml)
		$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
		$toast.Tag = $m.tag
		$toast.Group = $m.group
		$notifier.Show($toast)
	} catch {
		[Console]::Out.WriteLine((@{ error = "$_" } | ConvertTo-Json -Compress))
	}
}
