/**
 * lark/create_calendar_event.ts
 * 内置飞书工具：在用户主日历上创建日历事件
 */
import type { Tool, ToolContext } from '../../types.js';
import { getLarkUserToken, TOKEN_MISSING_MSG, larkApiWithUserToken } from './auth.js';

interface CalendarListResp {
  calendar_list?: { calendar_id: string; summary: string; type?: string; }[];
}

interface CalendarEventResp {
  event?: { event_id: string; summary: string; start_time?: { timestamp?: string }; };
}

/** 将本地时间字符串（Asia/Shanghai）转换为 Unix 时间戳（秒） */
function parseLocalTimestamp(dateStr: string): string {
  // 尝试解析 "2026-03-10 14:00" 或 ISO 格式
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + ':00+08:00');
  if (isNaN(d.getTime())) throw new Error(`无法解析时间：${dateStr}`);
  return String(Math.floor(d.getTime() / 1000));
}

export const larkCreateCalendarEventTool: Tool = {
  name: 'lark_create_calendar_event',
  description: '在你的飞书主日历上创建日历事件，支持设置标题、时间、地点、描述和参与人。适合：安排会议、记录重要时间节点等。时间格式：YYYY-MM-DD HH:MM（东八区）。需要先完成飞书授权。',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '事件标题',
      },
      start_time: {
        type: 'string',
        description: '开始时间，格式 "YYYY-MM-DD HH:MM"（东八区）',
      },
      end_time: {
        type: 'string',
        description: '结束时间，格式 "YYYY-MM-DD HH:MM"（东八区）',
      },
      description: {
        type: 'string',
        description: '事件描述（可选）',
      },
      location: {
        type: 'string',
        description: '地点（可选）',
      },
      attendee_open_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '参与人的 open_id 列表（可选），如 ["ou_xxx"]',
      },
    },
    required: ['summary', 'start_time', 'end_time'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const userToken = getLarkUserToken(ctx.user_id);
    if (!userToken) return TOKEN_MISSING_MSG;

    const summary = (input['summary'] as string)?.trim();
    const startTimeStr = (input['start_time'] as string)?.trim();
    const endTimeStr = (input['end_time'] as string)?.trim();
    const description = (input['description'] as string | undefined)?.trim();
    const location = (input['location'] as string | undefined)?.trim();
    const attendeeOpenIds = input['attendee_open_ids'] as string[] | undefined;

    if (!summary || !startTimeStr || !endTimeStr) {
      return 'ERROR: summary、start_time、end_time 不能为空';
    }

    let startTimestamp: string;
    let endTimestamp: string;
    try {
      startTimestamp = parseLocalTimestamp(startTimeStr);
      endTimestamp = parseLocalTimestamp(endTimeStr);
    } catch (err) {
      return `时间格式错误：${String(err)}`;
    }

    if (parseInt(endTimestamp) <= parseInt(startTimestamp)) {
      return 'ERROR: 结束时间必须晚于开始时间';
    }

    try {
      // 获取主日历 ID
      const calListResp = await larkApiWithUserToken<CalendarListResp>(
        userToken,
        '/calendar/v4/calendars',
      );
      if (calListResp.code !== 0) return `获取日历失败（code=${calListResp.code}）：${calListResp.msg}`;

      const primaryCal = calListResp.data?.calendar_list?.find(c => c.type === 'primary') ?? calListResp.data?.calendar_list?.[0];
      if (!primaryCal) return '未找到可用日历';

      // 构建事件体
      const eventBody: Record<string, unknown> = {
        summary,
        start_time: { timestamp: startTimestamp, timezone: 'Asia/Shanghai' },
        end_time: { timestamp: endTimestamp, timezone: 'Asia/Shanghai' },
      };
      if (description) eventBody['description'] = description;
      if (location) eventBody['location'] = { name: location };
      if (attendeeOpenIds && attendeeOpenIds.length > 0) {
        eventBody['attendee_ability'] = 'none';
      }

      const createResp = await larkApiWithUserToken<CalendarEventResp>(
        userToken,
        `/calendar/v4/calendars/${primaryCal.calendar_id}/events`,
        { method: 'POST', body: eventBody },
      );

      if (createResp.code !== 0) return `创建事件失败（code=${createResp.code}）：${createResp.msg}`;

      const eventId = createResp.data?.event?.event_id;

      // 如果有参与人，追加邀请
      if (attendeeOpenIds && attendeeOpenIds.length > 0 && eventId) {
        try {
          await larkApiWithUserToken(
            userToken,
            `/calendar/v4/calendars/${primaryCal.calendar_id}/events/${eventId}/attendees`,
            {
              method: 'POST',
              body: {
                attendees: attendeeOpenIds.map(id => ({ type: 'user', open_id: id })),
              },
            },
          );
        } catch { /* 邀请失败不影响事件创建 */ }
      }

      return `日历事件「${summary}」创建成功！\n时间：${startTimeStr} — ${endTimeStr}\n事件 ID：${eventId ?? '未知'}`;
    } catch (err) {
      return `创建事件失败：${String(err)}`;
    }
  },
};
