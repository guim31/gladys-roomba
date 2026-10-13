// -----------------------------------------------------------------------------
// The robots the integration knows, kept in /data/robots.json (the container
// rootfs is read-only; /data is its only writable volume).
//
// Per robot (key: BLID): name, model (sku), firmware, IP, MAC, the local MQTT
// password and where it came from. The password is needed at every
// connection, so it is stored as is, in a file only the container user can
// read (mode 600); it never appears in a log.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'robots.json';
const FIELDS = ['name', 'sku', 'firmware', 'ip', 'mac', 'password', 'source', 'cap'];

export class RobotStore {
  /** @param {string} dir the data directory (/data) */
  constructor(dir) {
    this.dir = dir;
    this.robots = new Map();
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(join(this.dir, FILE), 'utf8'));
      for (const [blid, robot] of Object.entries(data?.robots ?? {})) {
        if (/^[A-Za-z0-9]+$/.test(blid) && robot && typeof robot === 'object') {
          this.robots.set(blid, { blid, ...pick(robot) });
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    return this;
  }

  /** @returns {object[]} every robot, sorted by name */
  list() {
    return [...this.robots.values()].sort((a, b) =>
      (a.name ?? a.blid).localeCompare(b.name ?? b.blid),
    );
  }

  get(blid) {
    return this.robots.get(blid) ?? null;
  }

  /**
   * Merge what was learned about a robot; null/undefined values keep the
   * stored ones.
   */
  async upsert(blid, values) {
    const current = this.robots.get(blid) ?? { blid };
    const next = { ...current };
    for (const [key, value] of Object.entries(pick(values))) {
      if (value !== null && value !== undefined && value !== '') {
        next[key] = value;
      }
    }
    this.robots.set(blid, next);
    await this.save();
    return next;
  }

  async remove(blid) {
    const removed = this.robots.delete(blid);
    if (removed) {
      await this.save();
    }
    return removed;
  }

  // Writes are serialized, and atomic (temporary file, then rename).
  save() {
    const run = async () => {
      await mkdir(this.dir, { recursive: true });
      const target = join(this.dir, FILE);
      const temporary = `${target}.tmp`;
      const robots = Object.fromEntries(
        [...this.robots.entries()].map(([blid, robot]) => [blid, pick(robot)]),
      );
      await writeFile(temporary, `${JSON.stringify({ version: 1, robots }, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, target);
    };
    this.writing = this.writing.then(run, run);
    return this.writing;
  }
}

function pick(robot) {
  return Object.fromEntries(FIELDS.filter((key) => key in robot).map((key) => [key, robot[key]]));
}
