import { DiscordSDK } from '@discord/embedded-app-sdk';

// This optional bundle is served over HTTP only. Offline index.html stays self-contained.
const params = new URLSearchParams(location.search);
const status = document.getElementById('platformStatus');
const setStatus = text => { if (status) status.textContent = text; };
if (params.has('frame_id') && window.parent !== window) {
  const clientId = window.PIXEL_SERVER_CONFIG?.clientId;
  if (!clientId) {
    setStatus('DISCORD · НУЖЕН CLIENT ID');
  } else {
    setStatus('DISCORD · ПОДКЛЮЧЕНИЕ…');
    try {
      const sdk = new DiscordSDK(clientId);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Handshake timeout')), 12000));
      window.PixelDiscordReady = Promise.race([sdk.ready(), timeout]).then(async () => {
        window.PixelDiscord = { sdk, instanceId: sdk.instanceId, platform: sdk.platform };
        const { code } = await sdk.commands.authorize({ client_id: clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
        const response = await fetch('/api/auth/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        const auth = await response.json();
        if (!response.ok) throw new Error(auth.error || 'Authorization failed');
        await sdk.commands.authenticate({ access_token: auth.access_token });
        window.PixelDiscordAuth = auth.token;
        setStatus('DISCORD ACTIVITY · ПОДКЛЮЧЕНО');
        window.dispatchEvent(new Event('pixel-discord-ready'));
        return { token: auth.token, id: auth.id };
      }).catch(error => { setStatus('DISCORD · ' + error.message); return null; });
    } catch (_) { setStatus('DISCORD · ОШИБКА НАСТРОЙКИ'); }
  }
} else {
  setStatus('БРАУЗЕР · КОМНАТЫ ОНЛАЙН');
}
