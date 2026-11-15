import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isImeComposing } from '../lib/keyboard';
import { SIDEBAR_SHOWN_QUERY } from './breakpoints';

/** 本文の見出し（h1）にフォーカスを移す。見つかれば true */
export function focusMainHeading(): boolean {
  const h1 = document.querySelector<HTMLElement>('main h1');
  if (!h1) return false;
  /** 見出しはふだん Tab で止まらないが、ここからだけはフォーカスできるようにする */
  h1.tabIndex = -1;
  h1.focus();
  return true;
}

/**
 * ページを切り替えたら、新しいページの見出しにフォーカスを移す。
 * 読み上げソフトに見出しが読まれ、続けて Tab を押すと本文に進める（サイドバーに戻らない）。
 * 最初に開いたときは動かさない。ツールの画面は遅れて読み込まれるので、見出しが現れるまで待つ。
 */
function useFocusHeadingOnNavigate() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (!focusMainHeading() && ++tries < 300) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
}

/** メニュー・検索・画面移動のキー操作とフォーカスを管理する。 */
export function useAppNavigation() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    /** CSS（layout.css）でサイドバーをメニューにたたむ幅と同じ値を使う。食い違うと、表示はメニューなのに閉じられてしまう */
    const desktop = window.matchMedia(SIDEBAR_SHOWN_QUERY);
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!menuOpen || paletteOpen) return;
    const closeOutside = (e: Event) => {
      if (e.target instanceof Node && !sidebarRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const closeOnEscape = (e: globalThis.KeyboardEvent) => {
      if (isImeComposing(e) || e.key !== 'Escape') return;
      /** 検索パレットを閉じた同じキーイベントで、メニューまで閉じない。 */
      if (!(e.target instanceof Node) || !sidebarRef.current?.contains(e.target)) return;
      e.preventDefault();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen, paletteOpen]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useFocusHeadingOnNavigate();
  return { paletteOpen, setPaletteOpen, menuOpen, setMenuOpen, sidebarRef, menuButtonRef, pathname };
}
