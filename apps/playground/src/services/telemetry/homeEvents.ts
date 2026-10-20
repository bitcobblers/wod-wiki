/**
 * Home page funnel events (PRD #767). One wrapper module owns the names so
 * the funnel taxonomy is asserted in exactly one place (TelemetryService
 * tests) and components never hand-write event strings.
 */
export const HOME_EVENTS = {
  demoOpened: 'home:demo_opened',
  demoRun: 'home:demo_run',
  demoEdited: 'home:demo_edited',
  libraryOpened: 'home:library_opened',
  feedsOpened: 'home:feeds_opened',
  noteCreated: 'home:note_created',
  lessonStarted: 'home:lesson_started',
  cheatsheetOpened: 'home:cheatsheet_opened',
  behaviorsOpened: 'home:behaviors_opened',
  analyticsGuideOpened: 'home:analytics_guide_opened',
  explorerOpened: 'home:explorer_opened',
  dashboardViewed: 'home:dashboard_viewed',
  effortsOpened: 'home:efforts_opened',
  referenceOpened: 'home:reference_opened',
  chapterHeroViewed: 'home:chapter_hero_viewed',
  chapterExampleRun: 'home:chapter_example_run',
  chapterGuideClicked: 'home:chapter_guide_clicked',
  hostedInterestClicked: 'home:hosted_interest_clicked',
  hostedSurveyOpened: 'home:hosted_survey_opened',
} as const;

export type HomeEventName = (typeof HOME_EVENTS)[keyof typeof HOME_EVENTS];
