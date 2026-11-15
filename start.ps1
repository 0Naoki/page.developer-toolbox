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
    if (-not $nodeCommand -or -not $npmCommand) {
        throw 'Node.js 22.12以上とnpmが必要です。Node.js 24をインストールしてから、もう一度実行してください。'
    }
    $nodeVersion = & $nodeCommand.Source -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.12.0') {
        throw 'Node.jsが古いか、実行できません。Node.js 24をインストールしてください。'
    }

    if (-not (Test-Path -LiteralPath 'node_modules/.bin/vite.cmd') -or
        -not (Test-Path -LiteralPath 'node_modules/.bin/tsc.cmd')) {
        Write-Host '初回の準備として、依存パッケージをダウンロードします。'
        # CI（.github/workflows/checks.yml）と同じく、依存のインストールスクリプトは実行しない。
        # 次の署名の検証より前に、改ざんされたパッケージのコードを動かさないため
        Invoke-ProjectNpm -Arguments @('ci', '--ignore-scripts')
        try {
            Invoke-ProjectNpm -Arguments @('run', 'audit:signatures')
        }
        catch {
            # 検証に通らなかった依存を残すと、次の起動では準備済みとみなして、検証せずに使ってしまうため消す
            Remove-Item -LiteralPath 'node_modules' -Recurse -Force -ErrorAction SilentlyContinue
            throw "依存パッケージの署名を検証できませんでした。ダウンロードした依存パッケージは削除しました。（$($_.Exception.Message)）"
        }
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
