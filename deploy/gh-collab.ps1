. "$PSScriptRoot\gh-info.ps1" | Out-Null

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

# الحساب المسجّل في المتصفح مختلف عن مالك الريبو — نضيفه كمتعاون حتى تشوفه Koyeb.
gh api --method PUT repos/5tcj5876g9-cyber/flix/collaborators/mknhadola1-rgb -f permission=push | ConvertFrom-Json | ForEach-Object {
    Write-Output ('invited=' + $_.invitee.login + ' permission=' + $_.permissions.push)
}

$collab = gh api repos/5tcj5876g9-cyber/flix/collaborators | ConvertFrom-Json
Write-Output ('collaborators=' + ($collab | ForEach-Object { $_.login }) -join ',')
