export type SectionRow = {
  term: string;
  subject: string;
  subjectName?: string;
  courseNumber: string;
  courseTitle: string;
  sectionId: string;
  meetingType: string;
  section: string;
  days: string;
  time: string;
  building: string;
  room: string;
  instructor: string;
  available: string;
  limit: string;
};

export type TermMeta = {
  code: string;
  label: string;
};
