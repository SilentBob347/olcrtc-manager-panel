import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Copy,
  Edit3,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./index.css";

type LocationState = {
  name: string;
  room_id: string;
  uri: string;
  carrier: string;
  transport: string;
  link: string;
  dns: string;
  running: boolean;
};

type ClientState = {
  client_id: string;
  locations: LocationState[];
};

type State = {
  name: string;
  port: number;
  client_count: number;
  running_count: number;
  clients: ClientState[];
};

type ClientForm = {
  client_id: string;
  name: string;
  carrier: string;
  transport: string;
  dns: string;
};

const carriers = ["wbstream", "jazz", "telemost"];
const transportsByCarrier: Record<string, string[]> = {
  wbstream: ["datachannel", "vp8channel", "seichannel", "videochannel"],
  jazz: ["datachannel", "vp8channel", "seichannel", "videochannel"],
  telemost: ["vp8channel", "videochannel"],
};

const defaultForm: ClientForm = {
  client_id: "",
  name: "",
  carrier: "wbstream",
  transport: "datachannel",
  dns: "1.1.1.1:53",
};

async function request(path: string, options?: RequestInit) {
  const res = await fetch(path, options);
  if (!res.ok) {
    throw new Error((await res.text()).trim() || res.statusText);
  }
  return res;
}

function transportOptions(carrier: string) {
  return transportsByCarrier[carrier] ?? transportsByCarrier.wbstream;
}

function normalizeForm(form: ClientForm): ClientForm {
  const options = transportOptions(form.carrier);
  return {
    ...form,
    transport: options.includes(form.transport) ? form.transport : options[0],
  };
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted hover:bg-muted/80"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ClientFormFields({
  form,
  setForm,
  includeClientID,
}: {
  form: ClientForm;
  setForm: (form: ClientForm) => void;
  includeClientID: boolean;
}) {
  const set = (patch: Partial<ClientForm>) => setForm(normalizeForm({ ...form, ...patch }));

  return (
    <div className="grid gap-4">
      {includeClientID && (
        <label className="grid gap-2 text-sm text-muted-foreground">
          Имя клиента
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={form.client_id}
            onChange={(event) => set({ client_id: event.target.value })}
            placeholder="client-id"
          />
        </label>
      )}
      <label className="grid gap-2 text-sm text-muted-foreground">
        Название локации
        <input
          className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Current VPS"
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-muted-foreground">
          Carrier
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={form.carrier}
            onChange={(event) => set({ carrier: event.target.value })}
          >
            {carriers.map((carrier) => (
              <option key={carrier} value={carrier}>
                {carrier}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Transport
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={form.transport}
            onChange={(event) => set({ transport: event.target.value })}
          >
            {transportOptions(form.carrier).map((transport) => (
              <option key={transport} value={transport}>
                {transport}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm text-muted-foreground">
        DNS
        <input
          className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
          value={form.dns}
          onChange={(event) => set({ dns: event.target.value })}
          placeholder="1.1.1.1:53"
        />
      </label>
    </div>
  );
}

function App() {
  const [state, setState] = useState<State | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<ClientState | null>(null);
  const [createForm, setCreateForm] = useState<ClientForm>(defaultForm);
  const [editForm, setEditForm] = useState<ClientForm>(defaultForm);

  const loadState = async () => {
    const res = await request("/api/state", { cache: "no-store" });
    setState((await res.json()) as State);
  };

  useEffect(() => {
    loadState().catch((err) => setNotice(err.message));
  }, []);

  const clients = state?.clients ?? [];

  const runAction = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(okText);
      await loadState();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setCreateForm(defaultForm);
    setCreateOpen(true);
  };

  const openEdit = (client: ClientState) => {
    const loc = client.locations[0];
    setEditClient(client);
    setEditForm(
      normalizeForm({
        client_id: client.client_id,
        name: loc?.name ?? client.client_id,
        carrier: loc?.carrier ?? "wbstream",
        transport: loc?.transport ?? "datachannel",
        dns: loc?.dns ?? "1.1.1.1:53",
      }),
    );
  };

  const addClient = () =>
    runAction(async () => {
      if (!createForm.client_id.trim()) throw new Error("Укажи имя клиента");
      await request("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: createForm.client_id.trim(),
          name: createForm.name.trim(),
          carrier: createForm.carrier,
          transport: createForm.transport,
          dns: createForm.dns.trim(),
        }),
      });
      setCreateOpen(false);
    }, "Клиент создан, room сгенерирован отдельно");

  const updateClient = () =>
    runAction(async () => {
      if (!editClient) return;
      await request(`/api/clients/${encodeURIComponent(editClient.client_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          carrier: editForm.carrier,
          transport: editForm.transport,
          dns: editForm.dns.trim(),
        }),
      });
      setEditClient(null);
    }, "Клиент обновлен");

  const deleteClient = (id: string) =>
    runAction(async () => {
      if (!window.confirm(`Удалить клиента ${id}?`)) return;
      await request(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
    }, "Клиент удален");

  const copyOlcBoxLink = (clientID: string, uri: string) =>
    runAction(async () => {
      if (!uri) throw new Error("OlcBox ссылка не найдена");
      await navigator.clipboard.writeText(uri);
    }, `Ссылка для ${clientID} скопирована`);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">OlcRTC Manager</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
              disabled={busy}
              onClick={() => runAction(loadState, "Обновлено")}
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 md:grid-cols-3">
          <StatCard icon={<Server className="h-4 w-4" />} label="Профиль" value={state?.name ?? "..."} />
          <StatCard icon={<Users className="h-4 w-4" />} label="Клиенты" value={state?.client_count ?? "..."} />
          <StatCard icon={<Activity className="h-4 w-4" />} label="Инстансы" value={state?.running_count ?? "..."} />
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-normal">Клиенты</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90"
                onClick={openCreate}
              >
                <Plus className="h-4 w-4" />
                Создать клиента
              </button>
            </div>
          </div>

          <div className="mt-3 min-h-5 text-sm text-muted-foreground">{notice}</div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-3 pr-3 font-medium">Клиент</th>
                  <th className="py-3 pr-3 font-medium">Локация</th>
                  <th className="py-3 pr-3 font-medium">Room</th>
                  <th className="py-3 pr-3 font-medium">Carrier</th>
                  <th className="py-3 pr-3 font-medium">Transport</th>
                  <th className="py-3 pr-3 font-medium">DNS</th>
                  <th className="py-3 pr-3 font-medium">Статус</th>
                  <th className="py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {clients.flatMap((client) =>
                  client.locations.map((loc, index) => (
                    <tr key={`${client.client_id}-${loc.room_id}-${loc.transport}`} className="border-b border-border/70">
                      <td className="py-3 pr-3 font-medium">{index === 0 ? client.client_id : ""}</td>
                      <td className="py-3 pr-3">{loc.name || "Default"}</td>
                      <td className="max-w-[220px] truncate py-3 pr-3 text-muted-foreground">{loc.room_id}</td>
                      <td className="py-3 pr-3">{loc.carrier}</td>
                      <td className="py-3 pr-3">{loc.transport}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{loc.dns}</td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs ${
                            loc.running ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {loc.running ? "running" : "stopped"}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {index === 0 && (
                          <div className="flex justify-end gap-2">
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => copyOlcBoxLink(client.client_id, loc.uri)}
                            >
                              <Copy className="h-4 w-4" />
                              OlcBox
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => openEdit(client)}
                            >
                              <Edit3 className="h-4 w-4" />
                              Edit
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-destructive/40 px-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                              disabled={busy}
                              onClick={() => deleteClient(client.client_id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Удалить
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {createOpen && (
        <Modal title="Создать клиента" onClose={() => setCreateOpen(false)}>
          <div className="p-5">
            <ClientFormFields form={createForm} setForm={setCreateForm} includeClientID />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setCreateOpen(false)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={busy}
                onClick={addClient}
              >
                <Plus className="h-4 w-4" />
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editClient && (
        <Modal title={`Редактировать ${editClient.client_id}`} onClose={() => setEditClient(null)}>
          <div className="p-5">
            <ClientFormFields form={editForm} setForm={setEditForm} includeClientID={false} />
            <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
              При изменении carrier или DNS будет создан новый room.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setEditClient(null)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={busy}
                onClick={updateClient}
              >
                <Edit3 className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
