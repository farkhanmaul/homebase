export type Occupant = { id: number; active: boolean; x?: number; y?: number; direction?: string; status?: string };
export class OfficeSession {
  api = '';
  token = '';
  id: number | null = null;
  releaseLock?: () => void;
  async configure() {
    const config = await fetch('config.json', { cache: 'no-store' }).then(r => r.json());
    this.api = String(config.apiUrl || '').replace(/\/$/, '');
  }
  async request(path: string, body?: unknown) {
    const response = await fetch(`${this.api}/api/office/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Office-Session': this.token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Tidak dapat terhubung ke kantor.');
    return data;
  }
  async availability(): Promise<Occupant[]> {
    if (this.api) return (await this.request('characters')).characters;
    if (!navigator.locks) throw new Error('Browser ini tidak mendukung sesi preview. Gunakan Chrome/Edge terbaru.');
    const snapshot = await navigator.locks.query();
    return Array.from({ length: 6 }, (_, i) => ({ id: i + 1, active: snapshot.held?.some(lock => lock.name === `office-character-${i + 1}`) || false }));
  }
  async claim(id: number) {
    if (this.api) {
      const data = await this.request('claim', { id });
      this.token = data.token; this.id = id; return;
    }
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request(`office-character-${id}`, { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('Karakter baru saja dipakai. Pilih yang lain.')); return; }
        this.id = id;
        await new Promise<void>(release => { this.releaseLock = release; resolve(); });
      }).catch(reject);
    });
  }
  async release() {
    if (this.api && this.token) await this.request('release', {});
    this.releaseLock?.(); this.releaseLock = undefined; this.token = ''; this.id = null;
  }
}
