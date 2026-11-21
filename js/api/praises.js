import { supabase } from '../supabase.js';
import { q } from './client.js';

export const PRAISE_TAGS = ['아이디어왕', '꼼꼼함', '시간약속', '분위기메이커', '자료조사', '발표천재', '든든함'];

/** 팀원 칭찬하기 = 좋아요. 메시지·태그는 선택 (같은 팀원에게 하루 한 번) */
export const sendPraise = ({ projectId, toUser, message = null, tag = null }) => q(
  supabase.from('praises').insert({ project_id: projectId, to_user: toUser, message: message || null, tag: tag || null }).select().single(),
  '좋아요를 보내지 못했어요.',
  { messages: { 23505: '오늘은 이미 이 팀원에게 좋아요를 보냈어요. 내일 또 보내 주세요!', 23514: '자기 자신에게는 보낼 수 없어요.' } },
);

export const listReceived = (pid, uid) => q(
  supabase.from('praises').select('*').eq('project_id', pid).eq('to_user', uid).order('created_at', { ascending: false }).limit(50),
  '받은 칭찬을 불러오지 못했어요.',
);
