import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  Drawing,
  GlobalSettings,
  SpaceMode,
  TreeData,
  User,
} from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ConfirmDialog } from "./ui/form-dialog";

export function PasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirm("");
      setError("");
    }
  }, [open]);
  const submit = async () => {
    if (password !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    try {
      await api.changePassword(password);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改失败");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>
            修改成功后，其他设备上的登录会话将失效。
          </DialogDescription>
        </DialogHeader>
        <div className="settings-form">
          <label>
            新密码
            <input
              type="password"
              value={password}
              minLength={6}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={password.length < 6 || !confirm}
            onClick={() => void submit()}
          >
            保存密码
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminSettingsPage({
  users,
  onChanged,
}: {
  users: User[];
  onChanged: () => void;
}) {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  useEffect(() => {
    api
      .adminSettings()
      .then(setSettings)
      .catch((reason) => setError(reason.message));
  }, []);
  const setNumber = (key: keyof GlobalSettings, value: string) =>
    setSettings((previous) =>
      previous ? { ...previous, [key]: Number(value) } : previous,
    );
  const save = async () => {
    if (!settings) return;
    try {
      setSettings(await api.updateAdminSettings(settings));
      setError("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    }
  };
  const act = async (action: () => Promise<void>) => {
    try {
      await action();
      onChanged();
      setError("");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
      return false;
    }
  };
  return (
    <div className="system-settings-page">
      <header className="system-settings-header">
        <div>
          <h2>系统设置</h2>
          <p>管理协作容量和用户。全局配置会持久化到服务配置文件。</p>
        </div>
      </header>
      <div className="system-settings-content">
        {settings && (
          <section className="admin-settings">
            <div className="settings-section-head">
              <div>
                <h3>协作人数上限</h3>
                <p>控制不同范围内可以同时编辑的最大人数。</p>
              </div>
              <Button onClick={() => void save()}>
                {saved ? "已保存" : "保存全局配置"}
              </Button>
            </div>
            <div className="settings-grid">
              <label>
                单文档编辑人数
                <input
                  type="number"
                  min="1"
                  value={settings.maxDocumentEditors}
                  onChange={(e) =>
                    setNumber("maxDocumentEditors", e.target.value)
                  }
                />
              </label>
              <label>
                单项目编辑人数
                <input
                  type="number"
                  min="1"
                  value={settings.maxProjectEditors}
                  onChange={(e) =>
                    setNumber("maxProjectEditors", e.target.value)
                  }
                />
              </label>
              <label>
                全局编辑人数
                <input
                  type="number"
                  min="1"
                  value={settings.maxGlobalEditors}
                  onChange={(e) =>
                    setNumber("maxGlobalEditors", e.target.value)
                  }
                />
              </label>
              <label>
                新图默认人数
                <input
                  type="number"
                  min="1"
                  value={settings.defaultDrawingLimit}
                  onChange={(e) =>
                    setNumber("defaultDrawingLimit", e.target.value)
                  }
                />
              </label>
            </div>
          </section>
        )}
        <section className="admin-users">
          <div className="settings-section-head">
            <div>
              <h3>用户管理</h3>
              <p>拉黑、重置密码或删除普通用户。</p>
            </div>
            <span>{users.filter((item) => !item.isAdmin).length} 个用户</span>
          </div>
          {users
            .filter((user) => !user.isAdmin)
            .map((user) => (
              <div key={user.id}>
                <span>
                  <b>{user.username}</b>
                  <small>{user.blocked ? "已拉黑" : "正常"}</small>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void act(() =>
                      api.updateUser(user.id, { blocked: !user.blocked }),
                    )
                  }
                >
                  {user.blocked ? "解除拉黑" : "拉黑"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setResetPassword("");
                    setResetUser(user);
                  }}
                >
                  重置密码
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setDeleteUser(user)}
                >
                  删除
                </Button>
              </div>
            ))}
        </section>
        {error && <p className="error">{error}</p>}
      </div>
      <Dialog
        open={Boolean(resetUser)}
        onOpenChange={(value) => !value && setResetUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置 {resetUser?.username} 的密码</DialogTitle>
            <DialogDescription>请输入至少 6 位的新密码。</DialogDescription>
          </DialogHeader>
          <div className="settings-form">
            <label>
              新密码
              <input
                autoFocus
                type="password"
                minLength={6}
                maxLength={128}
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUser(null)}>
              取消
            </Button>
            <Button
              disabled={resetPassword.length < 6}
              onClick={() => {
                if (!resetUser) return;
                const target = resetUser;
                void act(() =>
                  api.updateUser(target.id, { password: resetPassword }),
                ).then((success) => success && setResetUser(null));
              }}
            >
              重置密码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleteUser)}
        title={`删除用户 ${deleteUser?.username || ""}`}
        description="该用户及其个人文件将被永久删除，此操作无法撤销。"
        confirmLabel="确认删除"
        destructive
        onCancel={() => setDeleteUser(null)}
        onConfirm={() => {
          if (!deleteUser) return;
          const target = deleteUser;
          void act(() => api.removeUser(target.id)).then(
            (success) => success && setDeleteUser(null),
          );
        }}
      />
    </div>
  );
}

type Location = {
  key: string;
  label: string;
  space: SpaceMode;
  folderId: null | string;
  projectId: null | string;
};
export function MoveCopyDialog({
  drawing,
  operation,
  currentUser,
  onClose,
  onDone,
}: {
  drawing: Drawing | null;
  operation: "copy" | "move";
  currentUser: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tree, setTree] = useState<TreeData | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (drawing) {
      setName(drawing.name);
      setLocation("");
      setError("");
      api
        .tree()
        .then(setTree)
        .catch((reason) => setError(reason.message));
    }
  }, [drawing]);
  const locations = useMemo(() => {
    if (!tree) return [];
    const out: Location[] = [
      {
        key: "user:root",
        label: "我的用户空间 / 根目录",
        space: "user",
        folderId: null,
        projectId: null,
      },
    ];
    const walk = (
      parent: string | null,
      prefix: string,
      space: SpaceMode,
      rootId: string,
    ) =>
      tree.folders
        .filter(
          (folder) =>
            folder.space === space &&
            folder.parentId === parent &&
            (space === "user"
              ? folder.userId === rootId
              : folder.projectId === rootId),
        )
        .forEach((folder) => {
          out.push({
            key: `folder:${folder.id}`,
            label: `${prefix} / ${folder.name}`,
            space,
            folderId: folder.id,
            projectId: space === "project" ? rootId : null,
          });
          walk(folder.id, `${prefix} / ${folder.name}`, space, rootId);
        });
    walk(null, "我的用户空间", "user", currentUser.id);
    for (const project of tree.projects) {
      out.push({
        key: `project:${project.id}`,
        label: `项目 / ${project.name} / 根目录`,
        space: "project",
        folderId: null,
        projectId: project.id,
      });
      walk(null, `项目 / ${project.name}`, "project", project.id);
    }
    return out;
  }, [tree, currentUser.id]);
  useEffect(() => {
    if (locations.length && !location) setLocation(locations[0].key);
  }, [locations, location]);
  const submit = async () => {
    if (!drawing) return;
    const target = locations.find((item) => item.key === location);
    if (!target) return;
    try {
      await api.relocate(drawing.id, {
        operation,
        name,
        space: target.space,
        folderId: target.folderId,
        projectId: target.projectId,
      });
      onDone();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    }
  };
  return (
    <Dialog
      open={Boolean(drawing)}
      onOpenChange={(value) => !value && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {operation === "copy" ? "复制文件" : "移动文件"}
          </DialogTitle>
          <DialogDescription>
            选择当前用户空间或任意项目空间中的目标位置。
          </DialogDescription>
        </DialogHeader>
        <div className="settings-form">
          <label>
            文件名
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            目标位置
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              {locations.map((item) => (
                <option value={item.key} key={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!name.trim() || !location}
            onClick={() => void submit()}
          >
            {operation === "copy" ? "复制" : "移动"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
