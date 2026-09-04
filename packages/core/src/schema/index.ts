export { countWords } from './word-count.js';
export { parseCardText, type ParsedCard } from './parse-card.js';
export { validateCard, type ValidationResult } from './validate-card.js';
export { initLearningDir, isoWeek, DEFAULT_SETTINGS, type InitResult } from './init.js';
export { writeFileAtomic, appendLineAtomic } from './atomic-write.js';
export {
  countBlanks,
  validateFillQuestion,
  validateApplyQuestion,
  validateQuestionFile,
  findCardsMissingQuestions,
} from './validate-question.js';
export { validateReview, createInitialReview, nextCalendarDay } from './review.js';
export { validateLogEvent, recordEvent, parseLogLines } from './log.js';
export { validateCategory, validateSettings } from './validate-config.js';
export {
  initGitRepo,
  snapshotLearningDir,
  snapshotMessage,
  isGitAvailable,
  isOwnGitRepo,
  LEARNING_GITIGNORE,
  INIT_COMMIT_MESSAGE,
  FALLBACK_IDENTITY,
  GIT_UNAVAILABLE_WARNING,
  NOT_A_REPO_HINT,
  MISSING_DIR_HINT,
  type GitInitResult,
  type GitInitStatus,
  type SnapshotResult,
  type SnapshotStatus,
} from './git-repo.js';
