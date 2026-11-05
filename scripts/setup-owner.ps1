$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $projectRoot
try {
    $username = Read-Host 'OWNER username'
    $password = Read-Host 'OWNER password (input hidden)' -AsSecureString
    $confirmation = Read-Host 'Repeat OWNER password' -AsSecureString

    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
    try {
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)
        if ($plainPassword -cne $plainConfirmation) {
            throw 'Passwords did not match.'
        }

        $env:NORTHORDO_INITIAL_OWNER_USERNAME = $username
        $env:NORTHORDO_INITIAL_OWNER_PASSWORD = $plainPassword
        & node --env-file=server/.env server/src/auth/create-owner.ts
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not create the OWNER account.'
        }
    } finally {
        $env:NORTHORDO_INITIAL_OWNER_USERNAME = $null
        $env:NORTHORDO_INITIAL_OWNER_PASSWORD = $null
        if ($passwordPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
        if ($confirmationPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
        }
    }
} finally {
    Pop-Location
}
