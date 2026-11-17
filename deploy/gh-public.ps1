. "$PSScriptRoot\gh-info.ps1" | Out-Null

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

gh repo edit 5tcj5876g9-cyber/flix --visibility public --accept-visibility-change-consequences 2>&1 | Select-Object -First 3

$repo = gh api repos/5tcj5876g9-cyber/flix | ConvertFrom-Json
Write-Output ('private=' + $repo.private + ' url=' + $repo.html_url)
