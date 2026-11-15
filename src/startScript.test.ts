import { expect, it } from 'vitest';
import script from '../start.ps1?raw';

it('start.ps1 は BOM 付きで保存する（Windows PowerShell 5.1 が日本語を読めるように）', () => {
  expect(script.startsWith('﻿')).toBe(true);
});
