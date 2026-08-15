import { useEffect, useState } from "react";
import { History, UserCheck, Users } from "lucide-react";
import { api } from "../api";
import type { CollaborationStatus, DrawingActivity } from "../types";

const stamp = (value: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
export function CollaborationPanel({
  drawingId,
  onAccessChange,
}: {
  drawingId: string;
  onAccessChange?: (canEdit: boolean) => void;
}) {
  const [status, setStatus] = useState<CollaborationStatus | null>(null);
  const [activity, setActivity] = useState<DrawingActivity[]>([]);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      const [next, history] = await Promise.all([
        api.collaboration(drawingId),
        api.drawingActivity(drawingId),
      ]);
      setStatus(next);
      setActivity(history);
      onAccessChange?.(next.canEdit);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "协作状态加载失败");
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [drawingId]);
  const update = async (input: {
    enabled?: boolean;
    limit?: number;
    userId?: string;
    canEdit?: boolean;
  }) => {
    try {
      setStatus(await api.updateCollaboration(drawingId, input));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "设置失败");
    }
  };
  return (
    <div className="collaboration-panel">
      {status && (
        <section>
          <header>
            <Users size={15} />
            <b>参与修改人</b>
            <span>{status.canEdit ? "可编辑" : "只读"}</span>
          </header>
          {status.canManage && (
            <div className="collaboration-settings">
              <label>
                <input
                  type="checkbox"
                  checked={status.enabled}
                  onChange={(event) =>
                    void update({ enabled: event.target.checked })
                  }
                />
                开放协作
              </label>
              <label>
                编辑人数上限
                <input
                  type="number"
                  min="1"
                  max={status.maxLimit}
                  value={status.limit}
                  onChange={(event) =>
                    void update({ limit: Number(event.target.value) })
                  }
                />
                <small>最高 {status.maxLimit}</small>
              </label>
            </div>
          )}
          <div className="participant-list">
            {status.participants.map((person) => (
              <div key={person.user.id}>
                <i>{person.user.username.slice(0, 1).toUpperCase()}</i>
                <span>
                  <b>{person.user.username}</b>
                  <small>
                    {person.online ? "在线" : "离线"} ·{" "}
                    {person.canEdit ? "编辑" : "查看"}
                  </small>
                </span>
                {status.canManage &&
                  person.user.id !== status.participants[0]?.user.id && (
                    <button
                      onClick={() =>
                        void update({
                          userId: person.user.id,
                          canEdit: !person.canEdit,
                        })
                      }
                    >
                      {person.canEdit ? "踢出协作" : "加入协作"}
                    </button>
                  )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="activity-list">
        <header>
          <History size={15} />
          <b>最近修改</b>
          <span>{activity.length}/50</span>
        </header>
        {activity.map((item, index) => (
          <div key={`${item.user.id}-${item.changedAt}-${index}`}>
            <UserCheck size={13} />
            <span>
              <b>{item.user.username}</b>
              <small>{stamp(item.changedAt)}</small>
            </span>
          </div>
        ))}
        {!activity.length && <p>暂无修改记录</p>}
      </section>
      {error && <p className="error tree-error">{error}</p>}
    </div>
  );
}
