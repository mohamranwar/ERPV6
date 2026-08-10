/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import MonthCloseScreen, { type Unit } from './MonthCloseScreen';
import {
  readScorecardInputs, buildScorecard, runReadiness, writeSnapshot,
  readSnapshotHistory, exportPeriodCsv, exportPlanningDataCsv,
} from '../services/monthClose';
import { getPlanningPeriod } from '../supabaseClient';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastConfirmContext';

/**
 * Wires the month-close screen to live data.
 *
 * The screen itself is presentational — it takes a scorecard, a readiness
 * result and a history list. Everything that touches the database lives in
 * services/monthClose.ts, which keeps the close logic testable without
 * rendering anything.
 */
export default function MonthCloseContainer({ refreshKey }: { refreshKey?: number }) {
  const { settings } = useAppSettings();
  const { currentUser, hasRole } = useAuth();
  const { showToast } = useToast();

  const [historyKey, setHistoryKey] = useState(0);

  const period = getPlanningPeriod();

  const inputs = useMemo(() => readScorecardInputs(period), [period, refreshKey]);
  const scorecard = useMemo(() => buildScorecard(inputs), [inputs]);
  const readiness = useMemo(() => runReadiness(inputs, scorecard), [inputs, scorecard]);
  const history = useMemo(() => readSnapshotHistory(), [historyKey, refreshKey]);

  const handleClose = useCallback(async (_unit: Unit) => {
    try {
      await writeSnapshot({
        scorecard,
        readiness,
        // The bands in force right now are frozen with the snapshot, so
        // editing a threshold next year cannot repaint this month's history.
        thresholds: settings.thresholds,
        userId: currentUser?.id ?? 'unknown',
      });
      setHistoryKey(k => k + 1);
      showToast('success', `${period.slice(0, 7)} closed`);
    } catch (e) {
      // writeSnapshot saves locally first and only then syncs, so a failure
      // here means local-saved-but-not-synced. Saying so beats a bare
      // "failed", which would suggest nothing was written at all.
      showToast('error', e instanceof Error ? e.message : String(e));
    }
  }, [scorecard, readiness, settings.thresholds, currentUser, period, showToast]);

  return (
    <MonthCloseScreen
      scorecard={scorecard}
      readiness={readiness}
      history={history}
      canClose={hasRole('planner')}
      canReopen={hasRole('admin')}
      onClose={handleClose}
      onReopen={() => showToast('info', 'Reopen is admin-only and not yet enabled.')}
      onExportPeriod={exportPeriodCsv}
      onExportScorecard={() => exportPlanningDataCsv(period)}
    />
  );
}
