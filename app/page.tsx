"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Organization = "vitma-s" | "vitma-climate";
type EngineerOrganization = Organization | "unassigned" | "ignored";

type Assignment = {
  id: number | string;
  date: Date | null;
  engineer: string;
  serial: string | null;
};

type Purchase = {
  date: Date | null;
  quantity: number;
  organization: Organization | null;
  rawOrganization: string;
};

type SyncedData = {
  assignments: Array<{
    id: number | string;
    date: string | null;
    engineer: string;
    serial?: string | null;
  }>;
  purchases: Array<{
    id: number | string;
    date: string | null;
    quantity: number;
    organization: Organization;
    rawOrganization: string;
  }>;
  meta: {
    syncedAt: string;
    assignmentRows: number;
    itsAssignments: number;
    itsPurchases: number;
  };
};

type ServerState = {
  syncedData: SyncedData | null;
  engineerOrganizations: Record<string, EngineerOrganization>;
  updatedAt: string | null;
};

type SyncState = "idle" | "checking" | "syncing" | "login-required" | "error";
type Theme = "light" | "dark";

const ATOL_API_URL = "/api/atol";
const BASELINE_DATE = "2026-07-31";
// AC exports association timestamps in UTC without a timezone suffix.
// 11:07 in Krasnoyarsk is 04:07 in the exported report.
const BASELINE_AT = new Date(2026, 6, 31, 4, 7, 0);
const BASELINE_SHARED_BALANCE = 1706;
const BASELINE_ORGANIZATION_BALANCES: Record<Organization, number> = {
  "vitma-s": 1711,
  "vitma-climate": -5,
};

const ORGS: Array<{
  id: Organization;
  name: string;
  short: string;
  className: string;
}> = [
  {
    id: "vitma-s",
    name: "ВИТМА-С",
    short: "С",
    className: "org-coral",
  },
  {
    id: "vitma-climate",
    name: "ВИТМА-КЛИМАТ",
    short: "К",
    className: "org-blue",
  },
];

const formatNumber = new Intl.NumberFormat("ru-RU");
const formatDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const formatMonth = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  year: "numeric",
});

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <span className="glyph" aria-hidden="true">
      {children}
    </span>
  );
}

function normalize(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[ё]/g, "е");
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  const ru = text.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  if (ru) {
    const year = Number(ru[3]) < 100 ? 2000 + Number(ru[3]) : Number(ru[3]);
    const result = new Date(
      year,
      Number(ru[2]) - 1,
      Number(ru[1]),
      Number(ru[4] ?? 0),
      Number(ru[5] ?? 0),
    );
    return Number.isNaN(result.getTime()) ? null : result;
  }

  const iso = new Date(text);
  if (!Number.isNaN(iso.getTime())) {
    return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
  }
  return null;
}

function inputDate(date: Date | null) {
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function openDatePicker(input: HTMLInputElement) {
  input.focus();
  try {
    input.showPicker?.();
  } catch {
    // The focused native date input remains usable in browsers without showPicker.
  }
}

function handleDateFieldClick(event: React.MouseEvent<HTMLLabelElement>) {
  if (event.target instanceof HTMLInputElement) return;
  const input = event.currentTarget.querySelector("input");
  if (input) openDatePicker(input);
}

function KpiCard({
  icon,
  label,
  value,
  tone,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
  note?: string;
}) {
  return (
    <article className={`kpi-card ${tone}`}>
      <div className="kpi-top">
        <span>{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <strong className={value < 0 ? "negative" : ""}>{formatNumber.format(value)}</strong>
      <small>{note}</small>
    </article>
  );
}

export default function Home() {
  const [syncedData, setSyncedData] = useState<SyncedData | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("checking");
  const [syncMessage, setSyncMessage] = useState("");
  const [bridgeReady, setBridgeReady] = useState(false);
  const [engineerOrganizations, setEngineerOrganizations] = useState<
    Record<string, EngineerOrganization>
  >({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [baselineCollapsed, setBaselineCollapsed] = useState(true);
  const [engineersCollapsed, setEngineersCollapsed] = useState(true);
  const [expandedEngineer, setExpandedEngineer] = useState<string | null>(null);
  const [engineerEditingUnlocked, setEngineerEditingUnlocked] = useState(false);
  const [engineerPasswordConfigured, setEngineerPasswordConfigured] =
    useState(true);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [engineerPassword, setEngineerPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let active = true;
    const loadSharedState = async () => {
      try {
        const savedTheme = localStorage.getItem("its-theme");
        const savedEngineersCollapsed = localStorage.getItem(
          "its-engineers-collapsed",
        );
        const savedBaselineCollapsed = localStorage.getItem(
          "its-baseline-collapsed",
        );
        const nextTheme: Theme =
          savedTheme === "light" || savedTheme === "dark"
            ? savedTheme
            : window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light";
        setTheme(nextTheme);
        setEngineersCollapsed(savedEngineersCollapsed !== "false");
        setBaselineCollapsed(savedBaselineCollapsed !== "false");
        document.documentElement.dataset.theme = nextTheme;
      } catch {
        // Invalid or unavailable local storage should not block the application.
      }

      try {
        const response = await fetch(`${ATOL_API_URL}/state`, {
          cache: "no-store",
        });
        const state = (await response.json()) as ServerState;
        if (!response.ok) {
          throw new Error("Не удалось получить общие данные с сервера");
        }

        if (active) {
          setSyncedData(state.syncedData);
          setEngineerOrganizations(state.engineerOrganizations);
        }
      } catch (stateError) {
        if (active) {
          setSyncState("error");
          setSyncMessage(
            stateError instanceof Error
              ? stateError.message
              : "Не удалось загрузить общие данные",
          );
        }
      } finally {
        if (active) setStorageReady(true);
      }
    };
    void loadSharedState();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${ATOL_API_URL}/admin`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error();
        if (active) {
          setEngineerEditingUnlocked(Boolean(payload.unlocked));
          setEngineerPasswordConfigured(payload.configured !== false);
        }
      })
      .catch(() => {
        if (active) setEngineerEditingUnlocked(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    const refreshSharedState = async () => {
      try {
        const response = await fetch(`${ATOL_API_URL}/state`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const state = (await response.json()) as ServerState;
        if (active) {
          setSyncedData(state.syncedData);
          setEngineerOrganizations(state.engineerOrganizations);
        }
      } catch {
        // A temporary polling failure should not discard the last shared state.
      }
    };
    const interval = window.setInterval(refreshSharedState, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshSharedState();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("its-theme", theme);
    } catch {
      // Theme persistence is optional.
    }
  }, [storageReady, theme]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(
        "its-engineers-collapsed",
        String(engineersCollapsed),
      );
    } catch {
      // The preference is optional when browser storage is unavailable.
    }
  }, [engineersCollapsed, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(
        "its-baseline-collapsed",
        String(baselineCollapsed),
      );
    } catch {
      // The preference is optional when browser storage is unavailable.
    }
  }, [baselineCollapsed, storageReady]);

  useEffect(() => {
    let active = true;
    fetch(`${ATOL_API_URL}/health`)
      .then((response) => {
        if (!response.ok) throw new Error();
        if (active) {
          setBridgeReady(true);
          setSyncState("idle");
        }
      })
      .catch(() => {
        if (active) {
          setBridgeReady(false);
          setSyncState("error");
          setSyncMessage(
            "Локальный помощник не запущен. Перезапустите проект командой npm run dev.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const assignments = useMemo<Assignment[]>(
    () =>
      syncedData
        ? syncedData.assignments.map((assignment) => ({
            id: assignment.id,
            date: parseDate(assignment.date),
            engineer: assignment.engineer,
            serial: assignment.serial ?? null,
          }))
        : [],
    [syncedData],
  );

  const purchases = useMemo<Purchase[]>(
    () =>
      syncedData
        ? syncedData.purchases.map((purchase) => ({
            date: parseDate(purchase.date),
            quantity: purchase.quantity,
            organization: purchase.organization,
            rawOrganization: purchase.rawOrganization,
          }))
        : [],
    [syncedData],
  );

  const allDates = useMemo(
    () =>
      [...assignments.map((row) => row.date), ...purchases.map((row) => row.date)]
        .filter(
          (date): date is Date => Boolean(date && date > BASELINE_AT),
        )
        .sort((a, b) => a.getTime() - b.getTime()),
    [assignments, purchases],
  );

  const period = useMemo(() => {
    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    const toDate = to ? new Date(`${to}T23:59:59`) : null;
    return { fromDate, toDate };
  }, [from, to]);

  const inPeriod = useCallback(
    (date: Date | null) => {
      if (!date || date <= BASELINE_AT) return false;
      if (period.fromDate && date < period.fromDate) return false;
      if (period.toDate && date > period.toDate) return false;
      return true;
    },
    [period],
  );

  const throughPeriodEnd = useCallback(
    (date: Date | null) =>
      Boolean(
        date &&
          date > BASELINE_AT &&
          (!period.toDate || date <= period.toDate),
      ),
    [period.toDate],
  );

  const engineers = useMemo(() => {
    const rowsByEngineer = new Map<string, Assignment[]>();
    assignments.forEach((assignment) => {
      const rows = rowsByEngineer.get(assignment.engineer) ?? [];
      rows.push(assignment);
      rowsByEngineer.set(assignment.engineer, rows);
    });
    return [...rowsByEngineer.entries()]
      .map(([name, rows]) => {
        const periodAssignments = rows
          .filter(({ date }) => inPeriod(date))
          .sort(
            (a, b) =>
              (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
          );
        const months = new Map<string, { label: string; total: number }>();
        periodAssignments.forEach(({ date }) => {
          if (!date) return;
          const key = `${date.getFullYear()}-${date.getMonth()}`;
          const current = months.get(key);
          months.set(key, {
            label: formatMonth.format(date).replace(".", ""),
            total: (current?.total ?? 0) + 1,
          });
        });
        return {
          name,
          total: periodAssignments.length,
          assignments: periodAssignments,
          monthlyActivity: [...months.values()],
          organization: engineerOrganizations[name] ?? "unassigned",
        };
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ru"));
  }, [assignments, engineerOrganizations, inPeriod]);

  const report = useMemo(() => {
    const result: Record<
      Organization,
      { incoming: number; spent: number; balance: number }
    > = {
      "vitma-s": { incoming: 0, spent: 0, balance: 0 },
      "vitma-climate": { incoming: 0, spent: 0, balance: 0 },
    };

    purchases.forEach((purchase) => {
      if (purchase.organization && inPeriod(purchase.date)) {
        result[purchase.organization].incoming += purchase.quantity;
      }
    });

    assignments.forEach((assignment) => {
      if (!inPeriod(assignment.date)) return;
      const organization =
        engineerOrganizations[assignment.engineer] ?? "unassigned";
      if (
        organization === "vitma-s" ||
        organization === "vitma-climate"
      ) {
        result[organization].spent += 1;
      }
    });

    const balances = { ...BASELINE_ORGANIZATION_BALANCES };
    purchases.forEach((purchase) => {
      if (purchase.organization && throughPeriodEnd(purchase.date)) {
        balances[purchase.organization] += purchase.quantity;
      }
    });
    assignments.forEach((assignment) => {
      if (!throughPeriodEnd(assignment.date)) return;
      const organization =
        engineerOrganizations[assignment.engineer] ?? "unassigned";
      if (
        organization === "vitma-s" ||
        organization === "vitma-climate"
      ) {
        balances[organization] -= 1;
      }
    });

    ORGS.forEach(({ id }) => {
      result[id].balance = balances[id];
    });
    return result;
  }, [
    assignments,
    purchases,
    engineerOrganizations,
    inPeriod,
    throughPeriodEnd,
  ]);

  const activeEngineers = engineers.filter(
    ({ organization }) => organization !== "ignored",
  );
  const ignoredEngineers = engineers.filter(
    ({ organization }) => organization === "ignored",
  );

  const filteredEngineers = useMemo(() => {
    const term = normalize(search);
    return engineers.filter(
      ({ name, organization }) =>
        (showIgnored || organization !== "ignored") &&
        normalize(name).includes(term),
    );
  }, [engineers, search, showIgnored]);

  const unassignedEngineers = activeEngineers.filter(
    ({ organization }) => organization === "unassigned",
  );
  const unassignedPeriodEngineers = unassignedEngineers.filter(
    ({ total }) => total > 0,
  );
  const unresolvedPurchases = purchases.filter(
    ({ organization, date }) => !organization && inPeriod(date),
  );
  const assignedEngineerCount =
    activeEngineers.length - unassignedEngineers.length;
  const maxEngineerTotal = Math.max(
    1,
    ...activeEngineers.map(({ total }) => total),
  );
  const engineerOrganizationStats = [
    ...ORGS.map((org) => ({
      id: org.id,
      label: org.name,
      className: org.className,
      total: engineers
        .filter(({ organization }) => organization === org.id)
        .reduce((sum, engineer) => sum + engineer.total, 0),
    })),
    {
      id: "unassigned",
      label: "Не распределено",
      className: "org-neutral",
      total: engineers
        .filter(({ organization }) => organization === "unassigned")
        .reduce((sum, engineer) => sum + engineer.total, 0),
    },
  ];
  const engineerStatsTotal = engineerOrganizationStats.reduce(
    (sum, item) => sum + item.total,
    0,
  );
  const totalIncoming =
    report["vitma-s"].incoming + report["vitma-climate"].incoming;
  const totalSpent = assignments.filter(({ date }) => inPeriod(date)).length;
  const actualSharedBalance = useMemo(() => {
    const incoming = purchases.reduce(
      (total, purchase) =>
        throughPeriodEnd(purchase.date) ? total + purchase.quantity : total,
      0,
    );
    const spent = assignments.reduce(
      (total, assignment) =>
        throughPeriodEnd(assignment.date) ? total + 1 : total,
      0,
    );
    return BASELINE_SHARED_BALANCE + incoming - spent;
  }, [assignments, purchases, throughPeriodEnd]);
  const maxFlow = Math.max(
    1,
    ...ORGS.flatMap(({ id }) => [
      report[id].incoming,
      report[id].spent,
      Math.abs(report[id].balance),
    ]),
  );

  const extendPeriod = (dates: Date[]) => {
    const sorted = dates
      .filter((date) => date > BASELINE_AT)
      .sort((a, b) => a.getTime() - b.getTime());
    const last = sorted.length
      ? inputDate(sorted[sorted.length - 1])
      : BASELINE_DATE;
    setFrom((current) =>
      !current || current < BASELINE_DATE ? BASELINE_DATE : current,
    );
    setTo((current) => (!current || last > current ? last : current));
  };

  const setEngineerOrganization = (
    engineer: string,
    organization: EngineerOrganization,
  ) => {
    if (!engineerEditingUnlocked) {
      setPasswordDialogOpen(true);
      return;
    }
    const previous = engineerOrganizations[engineer] ?? "unassigned";
    setEngineerOrganizations((current) => ({
      ...current,
      [engineer]: organization,
    }));
    void fetch(`${ATOL_API_URL}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engineer, organization }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          if (response.status === 401) {
            setEngineerEditingUnlocked(false);
            setPasswordDialogOpen(true);
          }
          throw new Error(
            payload.error || "Не удалось сохранить распределение инженера",
          );
        }
      })
      .catch((saveError) => {
        setEngineerOrganizations((current) => ({
          ...current,
          [engineer]: previous,
        }));
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Не удалось сохранить распределение инженера",
        );
      });
  };

  const unlockEngineerEditing = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordLoading(true);
    try {
      const response = await fetch(`${ATOL_API_URL}/admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: engineerPassword }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.configured === false) {
          setEngineerPasswordConfigured(false);
        }
        throw new Error(payload.error || "Не удалось открыть редактирование");
      }
      setEngineerEditingUnlocked(true);
      setEngineerPasswordConfigured(true);
      setEngineerPassword("");
      setPasswordDialogOpen(false);
    } catch (loginError) {
      setPasswordError(
        loginError instanceof Error
          ? loginError.message
          : "Не удалось открыть редактирование",
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  const lockEngineerEditing = async () => {
    await fetch(`${ATOL_API_URL}/admin`, { method: "DELETE" }).catch(() => {});
    setEngineerEditingUnlocked(false);
    setEngineerPassword("");
  };

  const resetPeriod = () => {
    setFrom(BASELINE_DATE);
    setTo(
      allDates.length
        ? inputDate(allDates[allDates.length - 1])
        : BASELINE_DATE,
    );
  };

  const synchronize = async () => {
    setError("");
    setSyncMessage("");
    setSyncState("syncing");
    try {
      const response = await fetch(`${ATOL_API_URL}/sync`, { method: "POST" });
      const payload = await response.json();
      if (response.status === 401 && payload.loginRequired) {
        setBridgeReady(true);
        setSyncState("login-required");
        setSyncMessage(
          payload.error ||
            "Сессия АТОЛ истекла. Настройте учетные данные на сервере.",
        );
        return;
      }
      if (!response.ok) {
        throw new Error(payload.error || "Не удалось обновить данные");
      }

      const nextData = payload as SyncedData;
      setSyncedData(nextData);
      const dates = [
        ...nextData.assignments.map((item) => parseDate(item.date)),
        ...nextData.purchases.map((item) => parseDate(item.date)),
      ].filter((date): date is Date => Boolean(date));
      extendPeriod(dates);
      setBridgeReady(true);
      setSyncState("idle");
      setSyncMessage(
        `Получено ${formatNumber.format(nextData.meta.itsAssignments)} назначений и ${formatNumber.format(nextData.meta.itsPurchases)} закупок ИТС.`,
      );
    } catch (syncError) {
      setBridgeReady(false);
      setSyncState("error");
      setSyncMessage(
        syncError instanceof Error
          ? syncError.message
          : "Не удалось связаться с локальным помощником",
      );
    }
  };

  const lastSyncLabel = syncedData
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(syncedData.meta.syncedAt))
    : "";

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">ИТС</span>
          <div>
            <strong>Баланс подписок</strong>
            <small>панель оператора</small>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="status-line">
            <span className={assignments.length ? "status-dot ready" : "status-dot"} />
            {syncedData
              ? `Данные АТОЛ обновлены ${lastSyncLabel}`
              : "Данные ещё не загружены"}
          </div>
          <button
            className="theme-toggle"
            type="button"
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
            aria-label={
              theme === "dark"
                ? "Включить светлую тему"
                : "Включить тёмную тему"
            }
            title={
              theme === "dark"
                ? "Включить светлую тему"
                : "Включить тёмную тему"
            }
          >
            <Glyph>{theme === "dark" ? "☀" : "☾"}</Glyph>
            <span>{theme === "dark" ? "Светлая" : "Тёмная"}</span>
          </button>
        </div>
      </header>

      <div className="page-shell">
        <section className="hero">
          <div>
            <span className="eyebrow">Контроль лицензий АТОЛ Connect</span>
            <h1>
              Приход и расход <em>без ручного подсчёта</em>
            </h1>
            <p>
              Обновляйте закупки и назначения напрямую из кабинетов АТОЛ,
              распределяйте инженеров между компаниями и контролируйте остаток
              подписок за любой период.
            </p>
          </div>
          <div className="hero-badge">
            <Glyph>↻</Glyph>
            <span>
              Данные хранятся
              <strong>на общем локальном сервере</strong>
            </span>
          </div>
        </section>

        <section className="upload-panel" aria-label="Актуализация данных">
          <div className="section-heading">
            <div>
                <span className="step">01</span>
                <div>
                  <h2>Актуализация данных</h2>
                  <p>Закупки и назначения загружаются напрямую из кабинетов АТОЛ</p>
                </div>
              </div>
            {syncState === "syncing" && (
              <span className="loading-pill">
                Получаю данные…
              </span>
            )}
          </div>

          <div
            className={`sync-card ${
              syncedData ? "synced" : syncState === "error" ? "offline" : ""
            }`}
          >
            <div className="sync-icon" aria-hidden="true">
              <Glyph>{syncedData ? "✓" : "↻"}</Glyph>
            </div>
            <div className="sync-copy">
              <span className="eyebrow">
                {bridgeReady ? "Локальный помощник подключён" : "Связь с АТОЛ"}
              </span>
              <strong>
                {syncedData
                  ? `Актуальные данные на ${lastSyncLabel}`
                  : "Закупки из ЛКП и назначения из AC"}
              </strong>
              <small>
                {syncMessage ||
                  (syncedData
                    ? `${formatNumber.format(syncedData.meta.itsAssignments)} назначений · ${formatNumber.format(syncedData.meta.itsPurchases)} закупок ИТС`
                    : "Обновление выполняется на сервере без открытия окна браузера")}
              </small>
            </div>
            <div className="sync-actions">
              <button
                className="primary-button"
                type="button"
                onClick={synchronize}
                disabled={syncState === "syncing"}
              >
                {syncState === "login-required" ? "Повторить" : "Обновить данные"}
              </button>
            </div>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <Glyph>!</Glyph>
              <span>{error}</span>
              <button type="button" onClick={() => setError("")}>
                <Glyph>×</Glyph>
              </button>
            </div>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <span className="step">02</span>
              <div>
                <h2>Баланс за период</h2>
                <p>
                  {allDates.length
                    ? `${formatDate.format(BASELINE_AT)} — ${formatDate.format(
                        allDates[allDates.length - 1],
                      )}`
                    : "Точка отсчёта: 31.07.2026, 11:07"}
                </p>
              </div>
            </div>
          </div>

          <div className="period-filter" aria-label="Период отчёта">
            <div className="period-filter-title">
              <span className="period-icon">
                <Glyph>▣</Glyph>
              </span>
              <span>
                <strong>Период отчёта</strong>
                <small>Все показатели и назначения инженеров пересчитываются сразу</small>
              </span>
            </div>
            <label className="period-date" onClick={handleDateFieldClick}>
              <span>Дата начала</span>
              <input
                type="date"
                value={from}
                min={BASELINE_DATE}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
                onClick={(event) => openDatePicker(event.currentTarget)}
              />
            </label>
            <span className="period-arrow">→</span>
            <label className="period-date" onClick={handleDateFieldClick}>
              <span>Дата окончания</span>
              <input
                type="date"
                value={to}
                min={from || BASELINE_DATE}
                onChange={(event) => setTo(event.target.value)}
                onClick={(event) => openDatePicker(event.currentTarget)}
              />
            </label>
            <button
              className="period-reset"
              type="button"
              onClick={resetPeriod}
            >
              <Glyph>↻</Glyph>
              Весь период
            </button>
          </div>

          <div
            className={`baseline-panel ${
              baselineCollapsed ? "collapsed" : ""
            }`}
          >
            <button
              className="baseline-toggle"
              type="button"
              aria-expanded={!baselineCollapsed}
              aria-controls="baseline-details"
              onClick={() =>
                setBaselineCollapsed((current) => !current)
              }
            >
              <span>
                {baselineCollapsed ? "Показать точку отсчёта" : "Точка отсчёта"}
              </span>
              <span
                className={`toggle-chevron ${
                  baselineCollapsed ? "" : "up"
                }`}
                aria-hidden="true"
              />
            </button>
            {!baselineCollapsed && (
              <div className="baseline-strip" id="baseline-details">
                <strong>31.07.2026 · 11:07</strong>
                <span>
                  ВИТМА-С <b>+1711</b>
                </span>
                <span>
                  ВИТМА-КЛИМАТ <b className="negative">−5</b>
                </span>
                <span className="baseline-total">
                  Общий остаток AC <b>1706</b>
                </span>
              </div>
            )}
          </div>

          <div className="kpi-grid">
            <KpiCard
              icon={<Glyph>＋</Glyph>}
              label="Заказано"
              value={totalIncoming}
              tone="green"
              note="по двум организациям"
            />
            <KpiCard
              icon={<Glyph>−</Glyph>}
              label="Назначено"
              value={totalSpent}
              tone="orange"
              note="по распределённым инженерам"
            />
            <KpiCard
              icon={<Glyph>▤</Glyph>}
              label="Фактический остаток AC"
              value={actualSharedBalance}
              tone="navy"
              note="на конец выбранного периода"
            />
            <KpiCard
              icon={<Glyph>◎</Glyph>}
              label="Инженеры"
              value={assignedEngineerCount}
              tone="violet"
              note={`из ${formatNumber.format(activeEngineers.length)} активных распределено`}
            />
          </div>

          <div className="org-comparison">
            <div className="comparison-head">
              <h3>Движение за период и остаток на его конец</h3>
              <div className="legend">
                <span>
                  <i className="legend-incoming" /> приход
                </span>
                <span>
                  <i className="legend-spent" /> расход
                </span>
              </div>
            </div>
            <div className="org-table">
              <div className="org-table-head">
                <span>Организация</span>
                <span>Движение подписок</span>
                <span>Заказано</span>
                <span>Назначено</span>
                <span>Остаток на конец</span>
              </div>
              {ORGS.map((org) => {
                const values = report[org.id];
                return (
                  <div className="org-row" key={org.id}>
                    <div className="org-name">
                      <span className={`org-avatar ${org.className}`}>
                        {org.short}
                      </span>
                      <strong>{org.name}</strong>
                    </div>
                    <div className="flow-bars">
                      <span
                        className="flow incoming"
                        style={{
                          width: `${Math.max(
                            values.incoming ? 5 : 0,
                            (values.incoming / maxFlow) * 100,
                          )}%`,
                        }}
                      />
                      <span
                        className="flow spent"
                        style={{
                          width: `${Math.max(
                            values.spent ? 5 : 0,
                            (values.spent / maxFlow) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <strong>{formatNumber.format(values.incoming)}</strong>
                    <strong>{formatNumber.format(values.spent)}</strong>
                    <strong
                      className={`balance ${
                        values.balance < 0 ? "negative" : ""
                      }`}
                    >
                      {values.balance > 0 ? "+" : ""}
                      {formatNumber.format(values.balance)}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>

          {(unassignedPeriodEngineers.length > 0 ||
            unresolvedPurchases.length > 0) && (
            <div className="notice warning">
              <Glyph>!</Glyph>
              <div>
                <strong>Есть данные, не попавшие в баланс</strong>
                <span>
                  {unassignedPeriodEngineers.length > 0 &&
                    `${unassignedPeriodEngineers.length} инженеров без организации`}
                  {unassignedPeriodEngineers.length > 0 &&
                    unresolvedPurchases.length > 0 &&
                    " · "}
                  {unresolvedPurchases.length > 0 &&
                    `${unresolvedPurchases.length} строк покупок с неизвестной организацией`}
                </span>
              </div>
            </div>
          )}
        </section>

        <section
          className={`engineers-section ${
            engineersCollapsed ? "collapsed" : ""
          }`}
        >
          <div className="section-heading">
            <div>
              <span className="step">03</span>
              <div>
                <h2>Инженеры и организации</h2>
                <p>
                  Распределение и исключения сохраняются на общем сервере
                </p>
              </div>
            </div>
            <div className="engineer-tools">
              {!engineersCollapsed && (
                <>
                  <div className="search-box">
                    <Glyph>⌕</Glyph>
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Найти инженера"
                      aria-label="Найти инженера"
                    />
                  </div>
                  <span className="assignment-progress">
                    {activeEngineers.length
                      ? Math.round(
                          (assignedEngineerCount / activeEngineers.length) *
                            100,
                        )
                      : 0}
                    % распределено
                  </span>
                  {ignoredEngineers.length > 0 && (
                    <button
                      className={`ignored-toggle ${showIgnored ? "active" : ""}`}
                      type="button"
                      onClick={() => setShowIgnored((current) => !current)}
                    >
                      {showIgnored
                        ? "Скрыть исключённых"
                        : "Показать исключённых"}
                      <span>{ignoredEngineers.length}</span>
                    </button>
                  )}
                </>
              )}
              <button
                className={`engineer-access ${
                  engineerEditingUnlocked ? "unlocked" : ""
                }`}
                type="button"
                onClick={() =>
                  engineerEditingUnlocked
                    ? void lockEngineerEditing()
                    : setPasswordDialogOpen(true)
                }
              >
                <Glyph>{engineerEditingUnlocked ? "⌁" : "●"}</Glyph>
                <span>
                  {engineerEditingUnlocked
                    ? "Редактирование открыто"
                    : "Редактирование закрыто"}
                </span>
              </button>
              <button
                className="engineers-collapse"
                type="button"
                aria-expanded={!engineersCollapsed}
                aria-controls="engineers-content"
                onClick={() =>
                  setEngineersCollapsed((current) => !current)
                }
              >
                <span>{engineersCollapsed ? "Развернуть" : "Свернуть"}</span>
                <span
                  className={`toggle-chevron ${
                    engineersCollapsed ? "" : "up"
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          {!engineersCollapsed &&
            (engineers.length ? (
            <div id="engineers-content">
              <div className="engineer-overview">
                <div className="engineer-overview-copy">
                  <span className="eyebrow">Назначения за период</span>
                  <strong>
                    {formatNumber.format(engineerStatsTotal)} лицензий
                  </strong>
                  <small>
                    Распределение расхода между организациями
                  </small>
                </div>
                <div className="engineer-org-chart">
                  {engineerOrganizationStats.map((item) => (
                    <div className="engineer-org-stat" key={item.id}>
                      <div>
                        <span>{item.label}</span>
                        <strong>{formatNumber.format(item.total)}</strong>
                      </div>
                      <span className="engineer-org-track">
                        <span
                          className={item.className}
                          style={{
                            width: `${Math.max(
                              item.total ? 5 : 0,
                              engineerStatsTotal
                                ? (item.total / engineerStatsTotal) * 100
                                : 0,
                            )}%`,
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="engineer-list">
              <div className="engineer-list-head">
                <span>Инженер</span>
                <span>За период</span>
                <span>Организация</span>
                <span>Детали</span>
              </div>
              {filteredEngineers.map((engineer) => (
                <div
                  className={`engineer-card ${
                    engineer.organization === "ignored" ? "ignored" : ""
                  }`}
                  key={engineer.name}
                >
                  <div className="engineer-row">
                  <div className="engineer-name">
                    <span>{engineer.name.slice(0, 1).toLocaleUpperCase("ru-RU")}</span>
                    <div>
                      <strong>{engineer.name}</strong>
                      <small>
                        {engineer.organization === "ignored"
                          ? "Исключён — не влияет на баланс и предупреждения"
                          : engineer.organization === "unassigned"
                            ? "Не учитывается в балансе"
                            : ORGS.find(
                                ({ id }) => id === engineer.organization,
                              )?.name}
                      </small>
                    </div>
                  </div>
                  <strong className="engineer-count">
                    {formatNumber.format(engineer.total)}
                  </strong>
                  <div
                    className={`org-switch ${
                      engineer.organization === "ignored"
                        ? "ignored-controls"
                        : ""
                    } ${engineerEditingUnlocked ? "" : "locked"}`}
                    role="group"
                    aria-label={`Организация для ${engineer.name}`}
                  >
                    {engineer.organization === "ignored" ? (
                      <button
                        className="restore"
                        type="button"
                        disabled={!engineerEditingUnlocked}
                        onClick={() =>
                          setEngineerOrganization(engineer.name, "unassigned")
                        }
                      >
                        Вернуть инженера
                      </button>
                    ) : (
                      <>
                        {ORGS.map((org) => (
                          <button
                            key={org.id}
                            className={
                              engineer.organization === org.id ? "active" : ""
                            }
                            type="button"
                            disabled={!engineerEditingUnlocked}
                            onClick={() =>
                              setEngineerOrganization(engineer.name, org.id)
                            }
                          >
                            {org.name}
                          </button>
                        ))}
                        <button
                          className={
                            engineer.organization === "unassigned"
                              ? "active neutral"
                              : ""
                          }
                          type="button"
                          disabled={!engineerEditingUnlocked}
                          onClick={() =>
                            setEngineerOrganization(
                              engineer.name,
                              "unassigned",
                            )
                          }
                        >
                          Не указана
                        </button>
                        <button
                          className="exclude"
                          type="button"
                          disabled={!engineerEditingUnlocked}
                          onClick={() =>
                            setEngineerOrganization(engineer.name, "ignored")
                          }
                        >
                          Исключить
                        </button>
                      </>
                    )}
                  </div>
                  <button
                    className="engineer-detail-toggle"
                    type="button"
                    aria-expanded={expandedEngineer === engineer.name}
                    onClick={() =>
                      setExpandedEngineer((current) =>
                        current === engineer.name ? null : engineer.name,
                      )
                    }
                  >
                    <span>
                      {expandedEngineer === engineer.name
                        ? "Скрыть"
                        : "Подробнее"}
                    </span>
                    <span
                      className={`toggle-chevron ${
                        expandedEngineer === engineer.name ? "up" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  </div>

                  {expandedEngineer === engineer.name && (
                    <div className="engineer-detail-panel">
                      <div className="engineer-detail-summary">
                        <div className="engineer-total-visual">
                          <span>Доля активности среди инженеров</span>
                          <strong>
                            {formatNumber.format(engineer.total)}
                            <small> назначений</small>
                          </strong>
                          <span className="engineer-total-track">
                            <span
                              style={{
                                width: `${(engineer.total / maxEngineerTotal) * 100}%`,
                              }}
                            />
                          </span>
                        </div>
                        <div className="engineer-month-chart">
                          <span>Активность по месяцам</span>
                          {engineer.monthlyActivity.length ? (
                            <div className="month-bars">
                              {engineer.monthlyActivity.map((month) => {
                                const monthMax = Math.max(
                                  1,
                                  ...engineer.monthlyActivity.map(
                                    ({ total }) => total,
                                  ),
                                );
                                return (
                                  <div className="month-bar" key={month.label}>
                                    <span
                                      style={{
                                        height: `${Math.max(
                                          8,
                                          (month.total / monthMax) * 100,
                                        )}%`,
                                      }}
                                    />
                                    <strong>{month.total}</strong>
                                    <small>{month.label}</small>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <small className="no-period-activity">
                              В выбранном периоде назначений нет
                            </small>
                          )}
                        </div>
                      </div>
                      <div className="assignment-history">
                        <div className="assignment-history-title">
                          <strong>Список назначений</strong>
                          <span>
                            {formatNumber.format(engineer.assignments.length)}
                          </span>
                        </div>
                        {engineer.assignments.length ? (
                          <div className="assignment-history-list">
                            {engineer.assignments.map((assignment, index) => (
                              <div
                                className="assignment-history-row"
                                key={assignment.id}
                              >
                                <span className="assignment-sequence">
                                  {index + 1}
                                </span>
                                <div>
                                  <strong>
                                    {assignment.serial
                                      ? `Устройство ${assignment.serial}`
                                      : "Назначение ИТС"}
                                  </strong>
                                  <small>
                                    Дата ассоциации ·{" "}
                                    {assignment.date
                                      ? formatDate.format(assignment.date)
                                      : "не указана"}
                                  </small>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="assignment-history-empty">
                            Нет назначений за выбранный период
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!filteredEngineers.length && (
                <div className="empty-row">Инженеры не найдены</div>
              )}
              </div>
            </div>
          ) : (
            <div className="empty-state" id="engineers-content">
              <div className="empty-illustration">
                <Glyph>▦</Glyph>
                <span />
              </div>
              <div>
                <strong>Обновите данные из АТОЛ</strong>
                <p>
                  После синхронизации здесь появятся инженеры и количество
                  назначений за выбранный период.
                </p>
              </div>
            </div>
          ))}
        </section>

        <footer>
          <span>ИТС Баланс</span>
          <p>
            Данные обновляются напрямую из кабинетов АТОЛ и доступны всем
            компьютерам локальной сети.
          </p>
          <span className="footer-orgs">
            <Glyph>▥</Glyph> ВИТМА-С · ВИТМА-КЛИМАТ
          </span>
        </footer>
      </div>

      {passwordDialogOpen && (
        <div className="password-dialog-backdrop" role="presentation">
          <div
            className="password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-dialog-title"
          >
            <button
              className="password-dialog-close"
              type="button"
              aria-label="Закрыть"
              onClick={() => {
                setPasswordDialogOpen(false);
                setPasswordError("");
                setEngineerPassword("");
              }}
            >
              ×
            </button>
            <span className="password-dialog-icon">
              <Glyph>●</Glyph>
            </span>
            <span className="eyebrow">Защищённое действие</span>
            <h2 id="password-dialog-title">
              Открыть редактирование инженеров
            </h2>
            <p>
              Принадлежность инженеров влияет на финансовый баланс. Введите
              пароль руководителя, чтобы изменить распределение.
            </p>
            <form onSubmit={unlockEngineerEditing}>
              <label>
                <span>Пароль</span>
                <input
                  type="password"
                  value={engineerPassword}
                  onChange={(event) =>
                    setEngineerPassword(event.target.value)
                  }
                  autoComplete="current-password"
                  autoFocus
                  disabled={passwordLoading}
                />
              </label>
              {passwordError && (
                <div className="password-error" role="alert">
                  {passwordError}
                </div>
              )}
              {!engineerPasswordConfigured && (
                <div className="password-help">
                  Добавьте ENGINEER_ADMIN_PASSWORD в .env.local на сервере и
                  перезапустите проект.
                </div>
              )}
              <button
                className="primary-button"
                type="submit"
                disabled={passwordLoading || !engineerPassword}
              >
                {passwordLoading ? "Проверяю…" : "Открыть редактирование"}
              </button>
            </form>
            <small>Доступ автоматически закроется через 8 часов.</small>
          </div>
        </div>
      )}
    </main>
  );
}
