import { createContext, useContext, type ReactNode } from 'react';
import { InputSaveNotice } from './InputSaveNotice';

/**
 * 表示中のツールの名前（ツールの一覧の name）。ツールページ（src/app/ToolPage.tsx）が渡す。
 * 見出しを各ツールの画面に書き直すと、ツールの一覧の名前（サイドバー・検索・タブの題名）と食い違うため、ここから取る
 */
export const ToolNameContext = createContext('');

/** 各ツール画面の共通の枠。見出しはツールの一覧の name、説明はツールの画面で書く */
export function ToolShell({ description, children }: { description: string; children: ReactNode }) {
  const title = useContext(ToolNameContext);
  return (
    <section className="tool">
      <header className="tool-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <InputSaveNotice />
      {children}
    </section>
  );
}
