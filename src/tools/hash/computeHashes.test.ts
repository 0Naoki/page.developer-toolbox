import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeHashes, createHashComputer, MAX_CACHED_FILE_BYTES } from './computeHashes';
import * as hashing from './logic';
import { FILE_READ_ERROR } from '../../lib/file';

const context = () => ({ isCancelled: () => false, report: vi.fn() });
afterEach(() => vi.restoreAllMocks());

describe('入力ごとのハッシュ計算', () => {
  it('同じ小さいファイルのHMACは読込を共有し、鍵ごとの結果を返す。消去後は読み直す', async () => {
    const computer = createHashComputer();
    const file = new File(['abc'], 'cached.txt');
    const read = vi.spyOn(file, 'arrayBuffer');
    const input = { source: 'file', file, useHmac: true, key: 'first' } as const;
    const first = await computer.run(input, context());
    const second = await computer.run({ ...input, key: 'second' }, context());
    expect(read).toHaveBeenCalledTimes(1);
    expect(first.rows[0]?.hex).not.toBe(second.rows[0]?.hex);
    computer.clear();
    await computer.run(input, context());
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('別ファイルと上限を超えるファイルは、以前の読込結果を再利用しない', async () => {
    const computer = createHashComputer();
    const a = new File(['abc'], 'same.txt');
    const b = new File(['def'], 'same.txt');
    const readA = vi.spyOn(a, 'arrayBuffer');
    const readB = vi.spyOn(b, 'arrayBuffer');
    const request = (file: File) => ({ source: 'file' as const, file, useHmac: true, key: 'key' });
    await computer.run(request(a), context());
    await computer.run(request(b), context());
    await computer.run(request(a), context());
    expect(readA).toHaveBeenCalledTimes(2);
    expect(readB).toHaveBeenCalledTimes(1);
    vi.spyOn(a, 'size', 'get').mockReturnValue(MAX_CACHED_FILE_BYTES + 1);
    computer.clear();
    await computer.run(request(a), context());
    await computer.run(request(a), context());
    expect(readA).toHaveBeenCalledTimes(4);
  });

  it('読込中の同じファイルを共有し、取消した要求の結果は返さない。読込失敗は再試行できる', async () => {
    const computer = createHashComputer();
    const file = new File(['abc'], 'pending.txt');
    let finish!: (bytes: ArrayBuffer) => void;
    const read = vi.spyOn(file, 'arrayBuffer').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let cancelled = false;
    const input = { source: 'file', file, useHmac: true, key: 'old' } as const;
    const old = computer.run(input, { ...context(), isCancelled: () => cancelled });
    const current = computer.run({ ...input, key: 'new' }, context());
    cancelled = true;
    finish(new TextEncoder().encode('abc').buffer);
    expect(await old).toEqual({ rows: [], error: '' });
    expect((await current).rows).toHaveLength(4);
    expect(read).toHaveBeenCalledTimes(1);
    computer.clear();
    read.mockRejectedValueOnce(new Error('一時的な失敗'));
    await expect(computer.run(input, context())).rejects.toThrow(FILE_READ_ERROR);
    expect((await computer.run(input, context())).rows).toHaveLength(4);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('テキストとファイルで同じバイト列なら、全アルゴリズムの結果と順番が一致する', async () => {
    const text = await computeHashes({ source: 'text', text: 'abc', useHmac: false, key: '' }, context());
    const file = await computeHashes({ source: 'file', file: new File(['abc'], 'input.txt'), useHmac: false, key: '' }, context());
    expect(file).toEqual(text);
    expect(text.rows.map((row) => row.algorithm)).toEqual(hashing.ALGORITHMS);
    expect(text.rows.find((row) => row.algorithm === 'SHA-256')?.hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('HMAC では MD5 を計算せず、鍵を変えた要求を独立して処理する', async () => {
    const request = { source: 'text', text: 'abc', useHmac: true, key: 'first' } as const;
    const first = await computeHashes(request, context());
    const second = await computeHashes({ ...request, key: 'second' }, context());
    expect(first.rows.map((row) => row.algorithm)).toEqual(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);
    expect(first.rows.every((row, i) => row.hex !== second.rows[i]?.hex)).toBe(true);
  });

  it('ファイルを読めなければ、計算せず共通の失敗を呼び出し側へ返す', async () => {
    const file = new File(['abc'], 'removed.txt');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('移動済み'));
    const digest = vi.spyOn(hashing, 'digest');
    await expect(computeHashes({ source: 'file', file, useHmac: false, key: '' }, context())).rejects.toThrow(FILE_READ_ERROR);
    expect(digest).not.toHaveBeenCalled();
  });

  it('SHA の完了前に取り消されたら、次のアルゴリズムと MD5 を開始しない', async () => {
    let cancelled = false;
    const digest = vi.spyOn(hashing, 'digest').mockImplementation(async () => {
      cancelled = true;
      return new Uint8Array([1]);
    });
    const md5 = vi.spyOn(hashing, 'md5Chunked');
    expect(await computeHashes({ source: 'text', text: 'abc', useHmac: false, key: '' }, { ...context(), isCancelled: () => cancelled })).toEqual({ rows: [], error: '' });
    expect(digest).toHaveBeenCalledTimes(1);
    expect(md5).not.toHaveBeenCalled();
  });

  it('暗号 API の失敗は途中の成功結果で隠さず、呼び出し側へ返す', async () => {
    vi.spyOn(hashing, 'digest').mockRejectedValue(new Error('暗号 API の失敗'));
    await expect(computeHashes({ source: 'text', text: 'abc', useHmac: false, key: '' }, context())).rejects.toThrow('暗号 API の失敗');
  });

  it('大きいファイルの MD5 の進捗で取り消すと、途中の SHA の値も結果として返さない', async () => {
    let cancelled = false;
    const ctx = { isCancelled: () => cancelled, report: vi.fn((_ratio: number) => { cancelled = true; }) };
    const file = new File([new Uint8Array(9 * 1024 * 1024)], 'large.bin');
    expect(await computeHashes({ source: 'file', file, useHmac: false, key: '' }, ctx)).toEqual({ rows: [], error: '' });
    expect(ctx.report).toHaveBeenCalledTimes(1);
    expect(ctx.report.mock.calls[0]?.[0]).toBeCloseTo(4 / 9);
  });
});
