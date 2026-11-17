# Windows PowerShell 5.1 / PowerShell 7 から、本番ビルドのアプリを起動する。
$ErrorActionPreference = 'Stop'
$exitCode = 0
$locationPushed = $false

function Invoke-ProjectNpm {
    param([string[]]$Arguments)

    # npm.ps1 の実行ポリシーに左右されないよう、Node.js 付属の npm.cmd を呼ぶ。
    & $npmCommand.Source @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') に失敗しました（終了コード $LASTEXITCODE）。"
    }
}

try {
    Push-Location -LiteralPath $PSScriptRoot
    $locationPushed = $true

    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    # 対応する版は package.json の engines（^22.12.0 || ^24.0.0 || >=26.0.0）と同じ。推奨は .nvmrc の 24
    $nodeRequirement = 'Node.js 24（または 22.12 以上の 22、26 以上）'
    if (-not $nodeCommand -or -not $npmCommand) {
        throw "$nodeRequirement とnpmが必要です。Node.js 24をインストールしてから、もう一度実行してください。"
    }
    $nodeVersion = & $nodeCommand.Source -p 'process.versions.node'
    $supported = $false
    if ($LASTEXITCODE -eq 0) {
        $version = [version]$nodeVersion
        $supported = ($version.Major -eq 22 -and $version -ge [version]'22.12.0') -or $version.Major -eq 24 -or $version.Major -ge 26
    }
    if (-not $supported) {
        throw "Node.js（$nodeVersion）はこのアプリに対応していないか、実行できません。$nodeRequirement をインストールしてください。"
    }

    # 依存の準備を終えた印。署名の検証が通った直後に、そのときの package-lock.json のハッシュを書く。
    # node_modules があるだけでは準備済みとみなさない。取得や検証の途中でウィンドウを閉じた・Ctrl+C で止めたときに、
    # 検証していない依存が残り、次の起動で検証せずに使ってしまうため。git pull などで package-lock.json が変わったときも、準備し直す
    $verifiedMarker = 'node_modules/.dev-toolbox-verified'
    $lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
    $verified = (Test-Path -LiteralPath $verifiedMarker) -and ((Get-Content -LiteralPath $verifiedMarker -Raw).Trim() -eq $lockHash)
    if (-not $verified) {
        if (Test-Path -LiteralPath 'node_modules') {
            Write-Host '依存パッケージが package-lock.json と合わないか、署名の検証を終えていないため、準備し直します。'
        }
        else {
            Write-Host '初回の準備として、依存パッケージをダウンロードします。'
        }
        # CI（.github/workflows/checks.yml）と同じ npm run setup。依存のインストールスクリプトは実行せずに取得し、署名を検証する
        try {
            Invoke-ProjectNpm -Arguments @('run', 'setup')
        }
        catch {
            # 取得や検証に失敗した依存は残さない（印がないので次の起動でも準備し直すが、途中の依存を誤って使わないように消す）
            Remove-Item -LiteralPath 'node_modules' -Recurse -Force -ErrorAction SilentlyContinue
            throw "依存パッケージの取得または署名の検証に失敗しました。ダウンロードした依存パッケージは削除しました。（$($_.Exception.Message)）"
        }
        Set-Content -LiteralPath $verifiedMarker -Value $lockHash -Encoding ascii -NoNewline
    }

    Write-Host '本番ビルドを作成しています。'
    Invoke-ProjectNpm -Arguments @('run', 'build')

    Write-Host 'ブラウザを開きます。停止するときは、このウィンドウで Ctrl+C を押してください。'
    Invoke-ProjectNpm -Arguments @('run', 'serve:pages', '--', '--open')
}
catch {
    $exitCode = 1
    Write-Host "起動できませんでした：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'ポートが使用中の場合は、既に起動しているプレビューを停止してください。'
    Read-Host 'Enterキーを押すと終了します' | Out-Null
}
finally {
    if ($locationPushed) { Pop-Location }
}

exit $exitCode
