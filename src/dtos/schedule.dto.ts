/**
 * Schedule DTOs
 *
 * The schedule defines when DJs have their shows.
 */

/** Days of the week */
export type DayOfWeek =
  | 'Sunday'
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday';

/** Schedule shift entry */
export interface ScheduleShift {
  id: number;
  dj_id: number;
  dj_name: string;
  day: DayOfWeek;
  start_time: string; // HH:MM format
  end_time: string; // HH:MM format
  show_name?: string;
  specialty_id?: number;
}

/** Weekly schedule (organized by day) */
export type WeeklySchedule = {
  [K in DayOfWeek]: ScheduleShift[];
};

/** Request to add a new schedule shift */
export interface AddScheduleShiftRequest {
  dj_id: number;
  day: DayOfWeek;
  start_time: string;
  end_time: string;
  show_name?: string;
  specialty_id?: number;
}

/** Specialty show type */
export interface SpecialtyShow {
  id: number;
  specialty_name: string;
  description?: string;
}
