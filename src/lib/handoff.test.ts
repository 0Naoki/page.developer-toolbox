import { expect, it } from 'vitest';
import { handOff, takeHandoff } from './handoff';

it('渡した値は、渡し先のツールが1回だけ受け取れる', () => {
  handOff('json', '{"a":1}');
  /** 別のツールは受け取れず、渡し先の値も消さない */
  expect(takeHandoff('csv')).toBeNull();
  expect(takeHandoff('json')).toBe('{"a":1}');
  expect(takeHandoff('json')).toBeNull();
});

it('受け取る前に別の値を渡すと、前の値は捨てる（空文字も値として渡せる）', () => {
  handOff('json', 'old');
  handOff('json', '');
  expect(takeHandoff('json')).toBe('');
  expect(takeHandoff('json')).toBeNull();
});
