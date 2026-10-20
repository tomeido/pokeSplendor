// A tab can stay open across deployments while reconnecting to a newer server.
// Refresh its bundled Pokémon catalog before it renders names it does not know.
let refreshing = false;

export function receiveClientVersion({ asset }: { asset: string | null }): void {
  if (!import.meta.env.PROD || !asset || refreshing) return;
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  if (!entry) return;
  if (new URL(asset, window.location.href).pathname === new URL(entry.src).pathname) return;
  refreshing = true;
  window.location.reload();
}

export async function checkClientVersion(): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/client-version`, { cache: 'no-store' });
    if (response.ok) receiveClientVersion(await response.json());
  } catch { /* Keep the current game available during a network interruption. */ }
}
