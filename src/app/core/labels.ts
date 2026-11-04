import { Injectable, computed, inject } from '@angular/core';
import { InstitutionType } from './models/models';
import { CentreService } from './services/centre.service';

/**
 * Every word that differs between coaching centres and schools lives here.
 * Screens use `labels.l().group` instead of typing "Batch" or "Class", so a new
 * institution type only needs a new entry below.
 */
export interface Labels {
  org: string;
  orgLower: string;
  group: string;
  groups: string;
  groupLower: string;
  groupsLower: string;
  addGroup: string;
  groupHint: string;
  orgNamePlaceholder: string;
  sizeOptions: string[];
  defaultSize: string;
}

export const LABELS: Record<InstitutionType, Labels> = {
  Coaching: {
    org: 'Centre',
    orgLower: 'centre',
    group: 'Batch',
    groups: 'Batches',
    groupLower: 'batch',
    groupsLower: 'batches',
    addGroup: 'Add batch',
    groupHint: 'A batch is a group of students who study together at the same time.',
    orgNamePlaceholder: 'e.g. Sharma Classes',
    sizeOptions: ['Under 50', '50–150', '150–300', '300+'],
    defaultSize: '50–150',
  },
  School: {
    org: 'School',
    orgLower: 'school',
    group: 'Class',
    groups: 'Classes',
    groupLower: 'class',
    groupsLower: 'classes',
    addGroup: 'Add class',
    groupHint: 'Add each class with its sections, like Class 8 with sections A and B.',
    orgNamePlaceholder: 'e.g. Sunrise Public School',
    sizeOptions: ['Under 300', '300–1,000', '1,000–2,000', '2,000+'],
    defaultSize: '300–1,000',
  },
};

/** School class names in order. */
export const SCHOOL_CLASSES = ['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
export const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function schoolGroupName(className: string, section: string | null): string {
  const base = /^\d+$/.test(className) ? `Class ${className}` : className;
  return section ? `${base} · ${section}` : base;
}

@Injectable({ providedIn: 'root' })
export class LabelService {
  private readonly centre = inject(CentreService);
  readonly type = computed<InstitutionType>(() => this.centre.centre()?.institutionType ?? 'Coaching');
  readonly isSchool = computed(() => this.type() === 'School');
  readonly l = computed(() => LABELS[this.type()]);
}
