@echo off
chcp 65001 >nul
title ClipForge — public tunnel (free Cloudflare)
echo.
echo  ClipForge musi juz dzialac na http://127.0.0.1:3847
echo  Potem dostaniesz link https://....trycloudflare.com
echo  (dziala tylko gdy ten PC i ClipForge sa wlaczone)
echo.
cd /d "%~dp0"
npx --yes cloudflared tunnel --url http://127.0.0.1:3847
pause
