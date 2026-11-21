// 로그인 / 로그아웃 / 세션 가드
import { supabase } from './supabase.js';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** 로그인 안 되어 있으면 index.html 로 보낸다 (돌아올 주소 포함) */
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search + location.hash);
    location.replace(`index.html?next=${next}`);
    return new Promise(() => {});   // 이동하는 동안 이후 코드 실행 막기
  }
  return session;
}

export function signInWithEmail(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.href.split('#')[0] },
  });
}

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.href.split('#')[0] },
  });
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace('index.html');
}

export function onAuthChange(fn) {
  return supabase.auth.onAuthStateChange((_event, session) => fn(session));
}
