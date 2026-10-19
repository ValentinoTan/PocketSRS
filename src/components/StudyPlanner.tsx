/**
 * StudyPlanner.tsx - Goal-Driven Study Plan Maker & Pacing Engine (PRD §4.3 & Phase 4)
 * Allows users to establish time-bounded study goals for exams (e.g., JLPT, HSK),
 * calculates remaining active study days, steady-state daily review loads,
 * applies newCardsPerDay/retention targets across deck hierarchies,
 * and renders a main dashboard Live Pacing Banner with 1-tap Pace Recalculation.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import {
  Calendar,
  Clock,
  Target,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  X,
  Play,
  Flame,
  ChevronRight,
  BookOpen,
  Coffee,
} from 'lucide-react';
import {
  db,
  type StudyPlanRecord,
  type DeckRecord,
  type CardRecord,
} from '../storage/db';
import { getCurrentLogicalDayStart } from '../engine/rollover';

interface StudyPlannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDeck?: (deckId: string) => void;
}

const WEEKDAYS = [
  { day: 0, label: 'Sun', short: 'S' },
  { day: 1, label: 'Mon', short: 'M' },
  { day: 2, label: 'Tue', short: 'T' },
  { day: 3, label: 'Wed', short: 'W' },
  { day: 4, label: 'Thu', short: 'T' },
  { day: 5, label: 'Fri', short: 'F' },
  { day: 6, label: 'Sat', short: 'S' },
];

/**
 * Calculates effective active study days between a start time and deadline (excluding buffer days)
 * strictly matching the selected days of the week.
 */
export function calculateEffectiveStudyDays(
  startDateMs: number,
  targetDateMs: number,
  bufferDays: number,
  activeDaysOfWeek: number[]
): number {
  const cutoffMs = targetDateMs - bufferDays * 86400000;
  if (cutoffMs <= startDateMs) return 0;

  let activeCount = 0;
  const current = new Date(startDateMs);
  current.setHours(0, 0, 0, 0);

  const end = new Date(cutoffMs);
  end.setHours(0, 0, 0, 0);

  while (current.getTime() <= end.getTime()) {
    if (activeDaysOfWeek.includes(current.getDay())) {
      activeCount++;
    }
    current.setDate(current.getDate() + 1);
  }

  return activeCount;
}

/**
 * Interactive Study Planner Modal
 */
export const StudyPlannerModal: React.FC<StudyPlannerModalProps> = ({
  isOpen,
  onClose,
}) => {
  // Database Live Queries
  const allDecks = useLiveQuery(() => db.decks.filter((d) => !d.deletedAt).toArray()) || [];
  const existingPlans = useLiveQuery(() => db.studyPlans.toArray()) || [];
  const globalSettings = useLiveQuery(() => db.settings.get('global'));

  // Form State
  const [isCreating, setIsCreating] = useState(false);
  const [planTitle, setPlanTitle] = useState('');
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [targetDateStr, setTargetDateStr] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60); // Default 60 days in future
    return d.toISOString().split('T')[0];
  });
  const [bufferDays, setBufferDays] = useState<number>(7);
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5, 6]); // Default Mon-Sat
  const [dailyMinutesCap, setDailyMinutesCap] = useState<number>(25);
  const [targetRetention, setTargetRetention] = useState<number>(0.90);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Query unseen cards across selected decks
  const [unseenCardsCount, setUnseenCardsCount] = useState<number>(0);
  const [totalCardsCount, setTotalCardsCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    async function countDeckCards() {
      if (selectedDeckIds.length === 0) {
        if (isMounted) {
          setUnseenCardsCount(0);
          setTotalCardsCount(0);
        }
        return;
      }

      // Match cards in selected deck IDs
      const cards = await db.cards
        .where('deckId')
        .anyOf(selectedDeckIds)
        .filter((c) => !c.deletedAt)
        .toArray();

      if (isMounted) {
        setTotalCardsCount(cards.length);
        const unseen = cards.filter((c) => c.state === 0).length;
        setUnseenCardsCount(unseen);
      }
    }
    countDeckCards();
    return () => {
      isMounted = false;
    };
  }, [selectedDeckIds]);

  // Real-time Plan Projections
  const projections = useMemo(() => {
    const startMs = Date.now();
    const targetMs = new Date(targetDateStr).getTime();
    const effectiveDays = calculateEffectiveStudyDays(startMs, targetMs, bufferDays, activeDays);

    const newCardsPerDay = effectiveDays > 0 ? Math.ceil(unseenCardsCount / effectiveDays) : 0;
    // Estimated steady-state reviews = newCardsPerDay * factor based on retention
    const retentionFactor = 1 / (1 - Math.min(0.98, targetRetention));
    const estimatedDailyReviews = Math.round(newCardsPerDay * (retentionFactor * 0.35));

    // Estimated daily time = 12s per new card + 8s per review card
    const estimatedSeconds = newCardsPerDay * 12 + estimatedDailyReviews * 8;
    const estimatedMinutes = Math.round(estimatedSeconds / 60);

    const isFeasible = estimatedMinutes <= dailyMinutesCap;
    const isTight = !isFeasible && estimatedMinutes <= dailyMinutesCap * 1.35;

    return {
      effectiveDays,
      newCardsPerDay,
      estimatedDailyReviews,
      estimatedMinutes,
      isFeasible,
      isTight,
    };
  }, [targetDateStr, bufferDays, activeDays, unseenCardsCount, targetRetention, dailyMinutesCap]);

  // Handle plan activation
  const handleSaveAndActivatePlan = async () => {
    if (!planTitle.trim()) {
      alert('Please provide a title for this study plan.');
      return;
    }
    if (selectedDeckIds.length === 0) {
      alert('Please select at least one deck for this plan.');
      return;
    }
    if (projections.effectiveDays <= 0) {
      alert('The target date minus buffer days is already past or has zero active days. Please extend your target date.');
      return;
    }

    const planId = uuidv4();
    const targetMs = new Date(targetDateStr).getTime();
    const now = Date.now();

    // 1. Deactivate other active plans
    await db.studyPlans.toCollection().modify({ isActive: false });

    // 2. Create the new study plan
    const newPlan: StudyPlanRecord = {
      id: planId,
      title: planTitle.trim(),
      targetDeckIds: selectedDeckIds,
      startDate: now,
      targetDate: targetMs,
      bufferDays,
      activeDaysOfWeek: activeDays,
      dailyMinutesCap,
      targetRetention,
      computedNewCardsPerDay: projections.newCardsPerDay,
      computedReviewsPerDay: projections.estimatedDailyReviews,
      isActive: true,
      updatedAt: now,
    };

    await db.studyPlans.put(newPlan);

    // 3. Automatically apply computed pacing to all target decks
    for (const deckId of selectedDeckIds) {
      await db.decks.update(deckId, {
        newCardsPerDay: projections.newCardsPerDay,
        reviewsPerDay: projections.estimatedDailyReviews,
        updatedAt: now,
      });
    }

    // 4. Update global settings retention if desired
    await db.settings.update('global', {
      requestRetention: targetRetention,
      updatedAt: now,
    });

    setIsCreating(false);
    setToastMessage(`Study plan "${planTitle}" activated! Decks updated.`);
  };

  const handleTogglePlanActive = async (plan: StudyPlanRecord) => {
    const nextActive = !plan.isActive;
    const now = Date.now();

    if (nextActive) {
      // Deactivate others
      await db.studyPlans.toCollection().modify({ isActive: false });
      await db.studyPlans.update(plan.id, { isActive: true, updatedAt: now });

      // Apply to decks
      for (const deckId of plan.targetDeckIds) {
        await db.decks.update(deckId, {
          newCardsPerDay: plan.computedNewCardsPerDay,
          reviewsPerDay: plan.computedReviewsPerDay,
          updatedAt: now,
        });
      }
      setToastMessage(`Plan "${plan.title}" is now active!`);
    } else {
      await db.studyPlans.update(plan.id, { isActive: false, updatedAt: now });
      setToastMessage(`Plan "${plan.title}" deactivated.`);
    }
  };

  const handleDeletePlan = async (planId: string) => {
    if (confirm('Are you sure you want to delete this study plan?')) {
      await db.studyPlans.delete(planId);
      setToastMessage('Study plan deleted.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 animate-fadeIn">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                Goal-Driven Study Planner
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Paced exam preparation with automated daily card limits and retention targets
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toast Feedback */}
        {toastMessage && (
          <div className="px-6 py-2.5 bg-indigo-50 dark:bg-indigo-950/80 border-b border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!isCreating ? (
            /* PLANS LIST VIEW */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    Your Study Plans
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Switch between active exam tracks or craft a new goal-driven schedule.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsCreating(true);
                    setPlanTitle('');
                    setSelectedDeckIds([]);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-500/20 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create New Plan</span>
                </button>
              </div>

              {existingPlans.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl bg-gray-50/50 dark:bg-gray-800/20 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
                    <Target className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    No Study Plans Created Yet
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                    Set a deadline for an exam like JLPT or HSK, pick your decks, and PocketSRS will calculate your daily pace to ensure 100% completion with peak retention.
                  </p>
                  <button
                    onClick={() => setIsCreating(true)}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md transition-all inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Get Started
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {existingPlans.map((plan) => {
                    const daysLeft = Math.max(0, Math.ceil((plan.targetDate - Date.now()) / 86400000));
                    return (
                      <div
                        key={plan.id}
                        className={`p-4 rounded-2xl border transition-all ${
                          plan.isActive
                            ? 'bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-800 shadow-sm'
                            : 'bg-white dark:bg-gray-800/40 border-gray-200 dark:border-gray-800 opacity-80 hover:opacity-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                {plan.title}
                              </h4>
                              {plan.isActive ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white">
                                  ACTIVE
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Target Exam: {new Date(plan.targetDate).toLocaleDateString()} ({daysLeft} days remaining) · {plan.bufferDays}d buffer
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleTogglePlanActive(plan)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                                plan.isActive
                                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200'
                              }`}
                            >
                              {plan.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              onClick={() => handleDeletePlan(plan.id)}
                              className="p-1.5 rounded-xl text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                              title="Delete Plan"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Metrics Pills */}
                        <div className="mt-3 pt-3 border-t border-gray-200/60 dark:border-gray-700/60 flex flex-wrap gap-2 text-xs">
                          <div className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-indigo-500" />
                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                              {plan.computedNewCardsPerDay} new/day
                            </span>
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 flex items-center gap-1.5">
                            <RefreshCw className="w-3.5 h-3.5 text-purple-500" />
                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                              ~{plan.computedReviewsPerDay} reviews/day
                            </span>
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-blue-500" />
                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                              {plan.dailyMinutesCap}m budget
                            </span>
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                              {Math.round(plan.targetRetention * 100)}% retention
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* PLAN CREATOR WIZARD */
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-800">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-600" />
                  New Goal-Driven Study Plan
                </h3>
                <button
                  onClick={() => setIsCreating(false)}
                  className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 font-semibold"
                >
                  Cancel
                </button>
              </div>

              {/* Step 1: Plan Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  Plan Title
                </label>
                <input
                  type="text"
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  placeholder="e.g., JLPT N3 Summer Exam Prep or Minna no Nihongo Ch 1-25"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Step 2: Target Decks Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center justify-between">
                  <span>Select Target Books & Decks ({selectedDeckIds.length} selected)</span>
                  <span className="text-[11px] font-normal text-gray-500">
                    {unseenCardsCount} unseen / {totalCardsCount} total cards
                  </span>
                </label>
                <div className="max-h-44 overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-800 p-2 space-y-1 bg-gray-50/50 dark:bg-gray-800/30">
                  {allDecks.length === 0 ? (
                    <p className="text-xs text-gray-400 p-2">No decks found. Please import or create a deck first.</p>
                  ) : (
                    allDecks.map((deck) => {
                      const isSelected = selectedDeckIds.includes(deck.id);
                      return (
                        <div
                          key={deck.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedDeckIds((prev) => prev.filter((id) => id !== deck.id));
                            } else {
                              setSelectedDeckIds((prev) => [...prev, deck.id]);
                            }
                          }}
                          className={`p-2.5 rounded-xl cursor-pointer flex items-center justify-between text-xs transition-colors ${
                            isSelected
                              ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-semibold'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-4 h-4 rounded border flex items-center justify-center ${
                                isSelected
                                  ? 'bg-indigo-600 border-indigo-600 text-white'
                                  : 'border-gray-300 dark:border-gray-600'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <span>
                              {deck.book ? `${deck.book} / ` : ''}
                              {deck.chapter ? `${deck.chapter} / ` : ''}
                              {deck.name}
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-400">
                            {deck.language || 'ja-JP'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Step 3: Dates & Buffer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                    Target Exam / Completion Date
                  </label>
                  <input
                    type="date"
                    value={targetDateStr}
                    onChange={(e) => setTargetDateStr(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    Final Review Buffer Days
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={bufferDays}
                    onChange={(e) => setBufferDays(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-gray-400">
                    Days before exam with 0 new cards, dedicated solely to reinforcement.
                  </p>
                </div>
              </div>

              {/* Step 4: Active Study Days of Week */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  Active Study Days
                </label>
                <div className="flex gap-2">
                  {WEEKDAYS.map((wd) => {
                    const isActive = activeDays.includes(wd.day);
                    return (
                      <button
                        key={wd.day}
                        type="button"
                        onClick={() => {
                          if (isActive) {
                            if (activeDays.length > 1) {
                              setActiveDays((prev) => prev.filter((d) => d !== wd.day));
                            }
                          } else {
                            setActiveDays((prev) => [...prev, wd.day].sort());
                          }
                        }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-gray-700'
                        }`}
                      >
                        {wd.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 5: Daily Time Budget & Target Retention */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                    Daily Time Budget (Minutes)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    step={5}
                    value={dailyMinutesCap}
                    onChange={(e) => setDailyMinutesCap(Math.max(5, parseInt(e.target.value) || 25))}
                    className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                    Target Retention ({Math.round(targetRetention * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.80}
                    max={0.97}
                    step={0.01}
                    value={targetRetention}
                    onChange={(e) => setTargetRetention(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>80% (Speed)</span>
                    <span>90% (Standard)</span>
                    <span>97% (Strict Exam)</span>
                  </div>
                </div>
              </div>

              {/* Real-time Calculation Projection Banner */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  projections.isFeasible
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                    : projections.isTight
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    {projections.isFeasible ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    )}
                    <span
                      className={
                        projections.isFeasible
                          ? 'text-emerald-900 dark:text-emerald-200'
                          : projections.isTight
                          ? 'text-amber-900 dark:text-amber-200'
                          : 'text-rose-900 dark:text-rose-200'
                      }
                    >
                      {projections.isFeasible
                        ? 'Feasible Pace within Your Time Budget'
                        : projections.isTight
                        ? 'Tight Schedule - Requires Steady Focus'
                        : 'Pace Exceeds Your Daily Time Budget'}
                    </span>
                  </span>
                  <span className="text-xs font-mono font-bold">
                    {projections.effectiveDays} Active Study Days
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 rounded-xl bg-white/70 dark:bg-gray-900/60">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Required Pace</p>
                    <p className="text-base font-bold text-gray-900 dark:text-gray-100">
                      {projections.newCardsPerDay} <span className="text-[11px] font-normal">new/day</span>
                    </p>
                  </div>

                  <div className="p-2 rounded-xl bg-white/70 dark:bg-gray-900/60">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Steady Reviews</p>
                    <p className="text-base font-bold text-gray-900 dark:text-gray-100">
                      ~{projections.estimatedDailyReviews} <span className="text-[11px] font-normal">rev/day</span>
                    </p>
                  </div>

                  <div className="p-2 rounded-xl bg-white/70 dark:bg-gray-900/60">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Daily Study Time</p>
                    <p
                      className={`text-base font-bold ${
                        projections.estimatedMinutes > dailyMinutesCap
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      ~{projections.estimatedMinutes}m <span className="text-[11px] font-normal">/ {dailyMinutesCap}m</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAndActivatePlan}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Activate & Apply to Decks</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Main Dashboard Pacing Banner
 * Rendered at the top of DeckTree.tsx to show real-time progress against the active study plan.
 */
export const StudyPlanBanner: React.FC<{
  onOpenPlanner: () => void;
  onOpenDeck?: (deckId: string) => void;
}> = ({ onOpenPlanner, onOpenDeck }) => {
  const activePlan = useLiveQuery(() =>
    db.studyPlans.filter((p) => p.isActive).first()
  );
  const globalSettings = useLiveQuery(() => db.settings.get('global'));

  // Today's review log stats for active plan decks
  const [studiedTodayCount, setStudiedTodayCount] = useState({ newCards: 0, reviews: 0 });
  const [unseenRemaining, setUnseenRemaining] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcToast, setRecalcToast] = useState<string | null>(null);

  useEffect(() => {
    if (recalcToast) {
      const timer = setTimeout(() => setRecalcToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [recalcToast]);

  useEffect(() => {
    let isMounted = true;
    async function loadTodayStats() {
      if (!activePlan || activePlan.targetDeckIds.length === 0) return;

      const rolloverHour = globalSettings?.dayRolloverHour ?? 4;
      const logicalStart = getCurrentLogicalDayStart(new Date(), rolloverHour).getTime();

      // Get revlogs since rollover
      const todayLogs = await db.revlog
        .where('reviewTime')
        .aboveOrEqual(logicalStart)
        .filter((l) => !l.isRevoked)
        .toArray();

      // Find which cards belong to the plan decks
      const targetDeckCards = await db.cards
        .where('deckId')
        .anyOf(activePlan.targetDeckIds)
        .filter((c) => !c.deletedAt)
        .toArray();

      const cardMap = new Map(targetDeckCards.map((c) => [c.id, c]));
      const unseen = targetDeckCards.filter((c) => c.state === 0).length;

      let newCount = 0;
      let reviewCount = 0;

      for (const log of todayLogs) {
        if (cardMap.has(log.cardId)) {
          if (log.state === 0) {
            newCount++;
          } else {
            reviewCount++;
          }
        }
      }

      if (isMounted) {
        setStudiedTodayCount({ newCards: newCount, reviews: reviewCount });
        setUnseenRemaining(unseen);
      }
    }

    loadTodayStats();
    return () => {
      isMounted = false;
    };
  }, [activePlan, globalSettings]);

  if (!activePlan) return null;

  const todayDayOfWeek = new Date().getDay();
  const isRestDay = !activePlan.activeDaysOfWeek.includes(todayDayOfWeek);
  const daysUntilExam = Math.max(0, Math.ceil((activePlan.targetDate - Date.now()) / 86400000));

  // Dynamic Pace Recalculation
  const handleRecalculatePace = async () => {
    setIsRecalculating(true);
    const startMs = Date.now();
    const effectiveDays = calculateEffectiveStudyDays(
      startMs,
      activePlan.targetDate,
      activePlan.bufferDays,
      activePlan.activeDaysOfWeek
    );

    const updatedNewCardsPerDay = effectiveDays > 0 ? Math.ceil(unseenRemaining / effectiveDays) : 0;
    const retentionFactor = 1 / (1 - Math.min(0.98, activePlan.targetRetention));
    const updatedReviewsPerDay = Math.round(updatedNewCardsPerDay * (retentionFactor * 0.35));
    const now = Date.now();

    // Update plan
    await db.studyPlans.update(activePlan.id, {
      computedNewCardsPerDay: updatedNewCardsPerDay,
      computedReviewsPerDay: updatedReviewsPerDay,
      updatedAt: now,
    });

    // Update all target decks
    for (const deckId of activePlan.targetDeckIds) {
      await db.decks.update(deckId, {
        newCardsPerDay: updatedNewCardsPerDay,
        reviewsPerDay: updatedReviewsPerDay,
        updatedAt: now,
      });
    }

    setIsRecalculating(false);
    setRecalcToast(`Pace recalculated! Target is now ${updatedNewCardsPerDay} new cards/day.`);
  };

  const newCardsTarget = activePlan.computedNewCardsPerDay;
  const newCardsProgressPct = newCardsTarget > 0 ? Math.min(100, Math.round((studiedTodayCount.newCards / newCardsTarget) * 100)) : 100;

  return (
    <div className="mb-6 bg-gradient-to-r from-indigo-900 via-indigo-800 to-purple-900 text-white rounded-3xl p-5 shadow-xl border border-indigo-700/50 relative overflow-hidden animate-fadeIn">
      {/* Background decorative glow */}
      <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
        {/* Left Info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white/20 text-indigo-100 flex items-center gap-1">
              <Flame className="w-3 h-3 text-amber-300 fill-amber-300" />
              Active Exam Track
            </span>
            {isRestDay ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-gray-900 flex items-center gap-1">
                <Coffee className="w-3 h-3" />
                Scheduled Rest Day
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-400 text-gray-900">
                Study Day
              </span>
            )}
          </div>
          <h3 className="text-base md:text-lg font-bold text-white tracking-tight flex items-center gap-2">
            {activePlan.title}
          </h3>
          <p className="text-xs text-indigo-200">
            {daysUntilExam} days until deadline · {unseenRemaining} unseen cards remaining
          </p>
        </div>

        {/* Right Pacing Progress & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Daily New Progress */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 border border-white/10 min-w-[170px]">
            <div className="flex justify-between items-center text-xs mb-1.5">
              <span className="text-indigo-200 font-medium">Today's New Cards</span>
              <span className="font-bold text-white font-mono">
                {studiedTodayCount.newCards} / {newCardsTarget}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${newCardsProgressPct}%` }}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRecalculatePace}
              disabled={isRecalculating}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              title="Recalculate pace based on current remaining unseen cards"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
              <span>Recalculate Pace</span>
            </button>

            <button
              onClick={onOpenPlanner}
              className="px-3 py-2 rounded-xl bg-white text-indigo-900 hover:bg-indigo-50 text-xs font-bold shadow-md transition-all active:scale-95 flex items-center gap-1"
            >
              <span>Manage Plan</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {recalcToast && (
        <div className="mt-3 pt-2 border-t border-white/10 text-xs font-semibold text-emerald-300 flex items-center gap-1.5 animate-fadeIn">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{recalcToast}</span>
        </div>
      )}
    </div>
  );
};
