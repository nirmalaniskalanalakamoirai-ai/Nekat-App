// Semafor untuk membatasi pekerjaan mahal (scrypt ±128 MB per hitungan) agar login massal tidak
// menghabiskan CPU/RAM server (DoS). Antrean terbatas + batas waktu tunggu → GalatSibuk (HTTP 503).

export class GalatSibuk extends Error {
  constructor() {
    super("server sibuk");
    this.name = "GalatSibuk";
  }
}

export interface OpsiSemafor {
  /** Maksimal pekerjaan berjalan bersamaan. */
  readonly maks: number;
  /** Maksimal antrean menunggu; lebih dari itu langsung ditolak. */
  readonly maksAntre: number;
  /** Lama tunggu maksimal di antrean (ms). */
  readonly tungguMs: number;
}

export class Semafor {
  readonly #o: OpsiSemafor;
  #jalan = 0;
  readonly #antre: { mulai: () => void; batal: () => void }[] = [];

  constructor(o: OpsiSemafor) {
    this.#o = o;
  }

  get berjalan(): number {
    return this.#jalan;
  }

  async jalankan<T>(fn: () => Promise<T>): Promise<T> {
    await this.#ambil();
    try {
      return await fn();
    } finally {
      this.#lepas();
    }
  }

  #ambil(): Promise<void> {
    if (this.#jalan < this.#o.maks) {
      this.#jalan++;
      return Promise.resolve();
    }
    if (this.#antre.length >= this.#o.maksAntre) return Promise.reject(new GalatSibuk());
    return new Promise((selesai, gagal) => {
      const entri = {
        mulai: () => {
          clearTimeout(timer);
          this.#jalan++;
          selesai();
        },
        batal: () => {
          gagal(new GalatSibuk());
        },
      };
      const timer = setTimeout(() => {
        const i = this.#antre.indexOf(entri);
        if (i >= 0) this.#antre.splice(i, 1);
        entri.batal();
      }, this.#o.tungguMs);
      this.#antre.push(entri);
    });
  }

  #lepas(): void {
    this.#jalan--;
    this.#antre.shift()?.mulai();
  }
}
