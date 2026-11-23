// An allowlist prevents new private fields from leaking through public listings.
export const publicTuitionFields = {
  title: 1, subject: 1, classLevel: 1, mode: 1, location: 1,
  monthlyFee: 1, daysPerWeek: 1, classTimes: 1, description: 1,
  bannerImage: 1, approvalStatus: 1, isActive: 1, createdAt: 1,
}
