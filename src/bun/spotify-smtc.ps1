# Prints, every 3 seconds, one JSON line with what Spotify plays according to Windows' System Media Transport
# Controls (what the volume flyout shows): {"playing":false}, or the song with its position, its length and when
# Windows last dated that position. spotify.ts runs it (with -EncodedCommand) while Duvet shares Spotify's activity
# and kills it when that stops; it also ends with Duvet's process, as Bun's children do. A closed pipe alone wouldn't
# end it: Windows PowerShell 5.1 ignores writes that fail. Windows PowerShell 5.1 only: PowerShell 7 can't load
# WinRT types.
$ErrorActionPreference = 'Stop'
# Run from -EncodedCommand, PowerShell writes its progress (preparing modules on first use) to stderr as CLIXML.
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
	$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -match '^IAsyncOperation.1$'
})[0]
# Windows' media controls can stop answering (RequestAsync never returning, or refusing with RPC_E_CALL_CANCELED): a
# call they don't answer in 15 seconds fails. At the start the reader then ends with nothing read, and spotify.ts tries
# again later; in the loop, that read finds nothing playing.
function Await($operation, [Type]$type) {
	$task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
	if (-not $task.Wait(15000)) { throw "Windows' media controls didn't answer in 15 seconds" }
	$task.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

while ($true) {
	$line = '{"playing":false}'
	try {
		# Spotify's desktop app, or the one from the Microsoft Store.
		$session = $manager.GetSessions() | Where-Object {
			$_.SourceAppUserModelId -eq 'Spotify.exe' -or $_.SourceAppUserModelId -like 'SpotifyAB.SpotifyMusic*'
		} | Select-Object -First 1
		if ($session -and "$($session.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing') {
			$media = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
			$timeline = $session.GetTimelineProperties()
			$line = [pscustomobject]@{
				playing  = $true
				title    = $media.Title
				artist   = $media.Artist
				album    = $media.AlbumTitle
				position = [long]$timeline.Position.TotalMilliseconds
				duration = [long]$timeline.EndTime.TotalMilliseconds
				updated  = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
			} | ConvertTo-Json -Compress
		}
	} catch {
		# A session that ended while it was read: nothing plays this time, and the next read tries again.
		[Console]::Error.WriteLine("spotify-smtc: $($_.Exception.Message)")
	}
	[Console]::Out.WriteLine($line)
	[Console]::Out.Flush()
	Start-Sleep -Seconds 3
}
