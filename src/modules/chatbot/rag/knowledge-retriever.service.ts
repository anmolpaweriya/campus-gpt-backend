import { Injectable, Logger } from '@nestjs/common';
import { CourseService } from '../../courses/courses.services';
import { FacultyService } from '../../faculty/faculty.services';
import { BuildingService } from '../../building/building.service';
import { EventService } from '../../events/events.services';

export interface UserGeoLocation {
  latitude: number;
  longitude: number;
}

export interface RetrievalContextOptions {
  userId: string;
  query: string;
  location?: UserGeoLocation;
  clientTime?: string;
  timeZone?: string;
}

export interface BuildingDistanceInfo {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string | null;
  distanceMeters: number;
  walkTimeMinutes: number;
  directionsUrl: string;
}

export interface ResolvedClassInfo {
  day: string;
  startTime: string;
  endTime: string;
  subjectName: string;
  subjectCode?: string;
  room: string;
  blockName?: string;
  floor?: string;
  distanceMeters?: number;
  walkTimeMinutes?: number;
  directionsUrl?: string;
  facultyName?: string;
  status?: 'ongoing' | 'upcoming' | 'completed';
}

@Injectable()
export class KnowledgeRetrieverService {
  private readonly logger = new Logger(KnowledgeRetrieverService.name);

  // Default fallback reference coordinates: LPU Campus Academic Center (Near Block 34 / Central Lawns)
  public static readonly DEFAULT_LPU_LOCATION: UserGeoLocation = {
    latitude: 31.2536,
    longitude: 75.7037,
  };

  // In-memory cache with TTL for blazing-fast 0ms retrieval
  private cachedBuildings: any[] = [];
  private buildingsLastFetched = 0;

  private cachedFaculties: any[] = [];
  private facultiesLastFetched = 0;

  private cachedEvents: any[] = [];
  private eventsLastFetched = 0;

  // User course/timetable cache: key -> { data, timestamp }
  private userCourseCache = new Map<string, { data: any; timestamp: number }>();

  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly TIMETABLE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  constructor(
    private readonly courseService: CourseService,
    private readonly facultyService: FacultyService,
    private readonly buildingService: BuildingService,
    private readonly eventService: EventService,
  ) {}

  /**
   * Calculates distance in meters between two lat/lng coordinates (Haversine Formula)
   */
  public calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371e3; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const deltaPhi = toRad(lat2 - lat1);
    const deltaLambda = toRad(lon2 - lon1);

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) *
        Math.cos(phi2) *
        Math.sin(deltaLambda / 2) *
        Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
  }

  /**
   * Format distance into human-friendly string (e.g. '85 meters' or '1.20 km')
   */
  public formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${meters} meters`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  }

  /**
   * Estimate walking time assuming average campus walking speed of ~80 meters/min (4.8 km/h)
   */
  public estimateWalkingMinutes(meters: number): number {
    return Math.max(1, Math.ceil(meters / 80));
  }

  /**
   * Generate Google Maps directions or search pin link
   */
  public generateDirectionsUrl(
    destLat: number,
    destLng: number,
    userLocation?: UserGeoLocation,
  ): string {
    if (
      userLocation &&
      typeof userLocation.latitude === 'number' &&
      typeof userLocation.longitude === 'number'
    ) {
      return `https://www.google.com/maps/dir/?api=1&origin=${userLocation.latitude},${userLocation.longitude}&destination=${destLat},${destLng}&travelmode=walking`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${destLat},${destLng}`;
  }

  /**
   * Get cached buildings or refresh if expired
   */
  async getBuildings(): Promise<any[]> {
    const now = Date.now();
    if (
      this.cachedBuildings.length > 0 &&
      now - this.buildingsLastFetched < this.CACHE_TTL_MS
    ) {
      return this.cachedBuildings;
    }
    try {
      this.cachedBuildings = await this.buildingService.getAllBuildings();
      this.buildingsLastFetched = now;
    } catch (err) {
      this.logger.error('Failed to fetch buildings for cache', err);
    }
    return this.cachedBuildings;
  }

  /**
   * Get cached faculties or refresh if expired
   */
  async getFaculties(): Promise<any[]> {
    const now = Date.now();
    if (
      this.cachedFaculties.length > 0 &&
      now - this.facultiesLastFetched < this.CACHE_TTL_MS
    ) {
      return this.cachedFaculties;
    }
    try {
      this.cachedFaculties = await this.facultyService.findAll();
      this.facultiesLastFetched = now;
    } catch (err) {
      this.logger.error('Failed to fetch faculties for cache', err);
    }
    return this.cachedFaculties;
  }

  /**
   * Get cached events or refresh if expired
   */
  async getEvents(): Promise<any[]> {
    const now = Date.now();
    if (
      this.cachedEvents.length > 0 &&
      now - this.eventsLastFetched < this.CACHE_TTL_MS
    ) {
      return this.cachedEvents;
    }
    try {
      this.cachedEvents = await this.eventService.getEvents();
      this.eventsLastFetched = now;
    } catch (err) {
      this.logger.error('Failed to fetch events for cache', err);
    }
    return this.cachedEvents;
  }

  /**
   * Parse current date & time for temporal intelligence
   */
  private resolveTemporalContext(clientTime?: string, timeZone = 'Asia/Kolkata') {
    let dateObj: Date;
    if (clientTime) {
      dateObj = new Date(clientTime);
      if (isNaN(dateObj.getTime())) {
        dateObj = new Date();
      }
    } else {
      dateObj = new Date();
    }

    const timeFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const dayFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone,
      weekday: 'long',
    });

    const currentDay = dayFormatter.format(dateObj); // e.g. "Monday"
    const formattedDateTime = timeFormatter.format(dateObj); // e.g. "Monday, 16 Nov 2026, 09:30 am"

    const tomorrowDate = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDay = dayFormatter.format(tomorrowDate);

    const hourFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    });
    const minuteFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone,
      minute: '2-digit',
    });

    const currentHourMin = `${hourFormatter.format(dateObj).padStart(2, '0')}:${minuteFormatter.format(dateObj).padStart(2, '0')}`;

    return {
      currentDay,
      tomorrowDay,
      formattedDateTime,
      currentHourMin,
      timeZone,
    };
  }

  /**
   * Resolves a room number (e.g. "38-605" or "34-302") to its specific campus building,
   * floor number, distance from user, walking minutes, and Google Maps walking directions.
   */
  public resolveRoomDetails(
    roomStr: string,
    buildings: any[],
    userLocation: UserGeoLocation,
  ): {
    room: string;
    blockName: string;
    floor: string;
    distanceMeters: number;
    walkTimeMinutes: number;
    directionsUrl: string;
  } | null {
    if (!roomStr) return null;

    // Pattern matching: e.g. "38-605" or "Block 38 Room 605"
    const match = roomStr.match(/^(\d{2})[- ]?(\w+)?/i);
    if (!match) return null;

    const blockNum = match[1]; // e.g. "38"
    const roomPart = match[2] || ''; // e.g. "605"

    // Derive floor from room number: first digit usually represents the floor
    let floor = 'Ground Floor';
    if (roomPart.length >= 3 && /^[1-9]/.test(roomPart)) {
      const floorDigit = roomPart.charAt(0);
      floor = `${floorDigit}${floorDigit === '1' ? 'st' : floorDigit === '2' ? 'nd' : floorDigit === '3' ? 'rd' : 'th'} Floor`;
    }

    // Find building with matching block number in its name
    const foundBuilding = buildings.find(
      (b) =>
        b.name.toLowerCase().includes(`block ${blockNum}`) ||
        b.name.toLowerCase().includes(`block-${blockNum}`) ||
        b.name.includes(blockNum),
    );

    if (!foundBuilding) {
      return {
        room: roomStr,
        blockName: `Block ${blockNum}`,
        floor,
        distanceMeters: 300,
        walkTimeMinutes: 4,
        directionsUrl: `https://www.google.com/maps/search/?api=1&query=LPU+Block+${blockNum}`,
      };
    }

    const dist = this.calculateHaversineDistance(
      userLocation.latitude,
      userLocation.longitude,
      foundBuilding.latitude,
      foundBuilding.longitude,
    );

    return {
      room: roomStr,
      blockName: foundBuilding.name,
      floor,
      distanceMeters: dist,
      walkTimeMinutes: this.estimateWalkingMinutes(dist),
      directionsUrl: this.generateDirectionsUrl(
        foundBuilding.latitude,
        foundBuilding.longitude,
        userLocation,
      ),
    };
  }

  /**
   * Main RAG context generation method
   */
  async buildAugmentedContext(options: RetrievalContextOptions): Promise<string[]> {
    const { userId, query, location, clientTime, timeZone } = options;
    const lowerQuery = query.toLowerCase();

    // 1. Resolve Temporal State
    const temporal = this.resolveTemporalContext(clientTime, timeZone);

    // 2. Resolve Active Location (real GPS or campus center reference)
    const effectiveLocation: UserGeoLocation =
      location &&
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number'
        ? location
        : KnowledgeRetrieverService.DEFAULT_LPU_LOCATION;

    const isLiveGps = !!(
      location &&
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number'
    );

    // 3. Query Intent Detection
    const isClassQuery =
      lowerQuery.includes('class') ||
      lowerQuery.includes('lecture') ||
      lowerQuery.includes('timetable') ||
      lowerQuery.includes('schedule') ||
      lowerQuery.includes('tomorrow') ||
      lowerQuery.includes('today') ||
      lowerQuery.includes('next') ||
      lowerQuery.includes('subject') ||
      lowerQuery.includes('period') ||
      lowerQuery.includes('lab') ||
      lowerQuery.includes('timing');

    const isTomorrowQuery =
      lowerQuery.includes('tomorrow') ||
      lowerQuery.includes("tomorrow's") ||
      lowerQuery.includes('next day');

    const isLocationQuery =
      lowerQuery.includes('where') ||
      lowerQuery.includes('location') ||
      lowerQuery.includes('block') ||
      lowerQuery.includes('building') ||
      lowerQuery.includes('room') ||
      lowerQuery.includes('distance') ||
      lowerQuery.includes('how far') ||
      lowerQuery.includes('direction') ||
      lowerQuery.includes('reach') ||
      lowerQuery.includes('walk') ||
      lowerQuery.includes('near');

    const isWashroomQuery =
      lowerQuery.includes('washroom') ||
      lowerQuery.includes('toilet') ||
      lowerQuery.includes('restroom') ||
      lowerQuery.includes('urinal') ||
      lowerQuery.includes('lavatory');

    const isFacilityQuery =
      isWashroomQuery ||
      lowerQuery.includes('water') ||
      lowerQuery.includes('cooler') ||
      lowerQuery.includes('food') ||
      lowerQuery.includes('canteen') ||
      lowerQuery.includes('cafe') ||
      lowerQuery.includes('mall') ||
      lowerQuery.includes('unimall') ||
      lowerQuery.includes('eat') ||
      lowerQuery.includes('atm') ||
      lowerQuery.includes('bank') ||
      lowerQuery.includes('print') ||
      lowerQuery.includes('xerox') ||
      lowerQuery.includes('hospital') ||
      lowerQuery.includes('medical') ||
      lowerQuery.includes('doctor') ||
      lowerQuery.includes('ambulance') ||
      lowerQuery.includes('library') ||
      lowerQuery.includes('gym') ||
      lowerQuery.includes('sports');

    const isFacultyQuery =
      lowerQuery.includes('faculty') ||
      lowerQuery.includes('professor') ||
      lowerQuery.includes('teacher') ||
      lowerQuery.includes('sir') ||
      lowerQuery.includes('dr.') ||
      lowerQuery.includes('hod') ||
      lowerQuery.includes('dean') ||
      lowerQuery.includes('email') ||
      lowerQuery.includes('contact') ||
      lowerQuery.includes('phone') ||
      lowerQuery.includes('cabin');

    const isEventQuery =
      lowerQuery.includes('event') ||
      lowerQuery.includes('fest') ||
      lowerQuery.includes('hackathon') ||
      lowerQuery.includes('cultural') ||
      lowerQuery.includes('olympiad') ||
      lowerQuery.includes('spectra') ||
      lowerQuery.includes('unipolis');

    const contextSections: string[] = [];

    // --- Section 1: Precompute Geospatial Distances to All Buildings ---
    const allBuildings = await this.getBuildings();
    const sortedBuildings: BuildingDistanceInfo[] = allBuildings.map((b) => {
      const dist = this.calculateHaversineDistance(
        effectiveLocation.latitude,
        effectiveLocation.longitude,
        b.latitude,
        b.longitude,
      );
      const walkMin = this.estimateWalkingMinutes(dist);
      const dirUrl = this.generateDirectionsUrl(
        b.latitude,
        b.longitude,
        effectiveLocation,
      );
      return {
        id: b.id,
        name: b.name,
        latitude: b.latitude,
        longitude: b.longitude,
        description: b.description,
        distanceMeters: dist,
        walkTimeMinutes: walkMin,
        directionsUrl: dirUrl,
      };
    });

    sortedBuildings.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const closestBuilding = sortedBuildings.length > 0 ? sortedBuildings[0] : null;

    // Build Reference Frame
    let referenceFrame = `### 🕒 Real-Time Context:
- Current Timestamp: **${temporal.formattedDateTime}** (${temporal.timeZone})
- Current Day of Week: **${temporal.currentDay}** (Current 24h Time: \`${temporal.currentHourMin}\`)
- Tomorrow's Day of Week: **${temporal.tomorrowDay}**
- Student GPS Position: ${effectiveLocation.latitude.toFixed(6)}, ${effectiveLocation.longitude.toFixed(6)} (${isLiveGps ? 'Live Browser Geolocation' : 'Default Academic Center - Block 34'})`;

    if (closestBuilding) {
      referenceFrame += `\n- Closest Campus Landmark: **${closestBuilding.name}** (~${this.formatDistance(closestBuilding.distanceMeters)}, ~${closestBuilding.walkTimeMinutes} min walk)
- Walking Route to Nearest Landmark: [Navigate on Google Maps](${closestBuilding.directionsUrl})`;
    }
    contextSections.push(referenceFrame);

    // --- Section 2: Student Enrollment, Timetable & Class-to-Location Resolution ---
    try {
      // Check in-memory user course cache
      const cached = this.userCourseCache.get(userId);
      let userCourse: any;
      let timetable: any;

      if (cached && Date.now() - cached.timestamp < this.TIMETABLE_CACHE_TTL_MS) {
        userCourse = cached.data.userCourse;
        timetable = cached.data.timetable;
      } else {
        userCourse = await this.courseService.getUserCourse(userId);
        if (userCourse) {
          timetable = await this.courseService.getCourseTimetable(userId);
          this.userCourseCache.set(userId, {
            data: { userCourse, timetable },
            timestamp: Date.now(),
          });
        }
      }

      if (userCourse && timetable) {
        let scheduleContext = `### 🎓 Student Enrolled Course: **${userCourse.name}** (\`${userCourse.code}\`)\n`;

        // Helper to format class slots with exact distance and walking instructions
        const formatSlotsWithLocation = (slots: any[], dayLabel: string) => {
          if (!slots || slots.length === 0) {
            return `#### 📅 ${dayLabel} Schedule:\n- No classes scheduled for ${dayLabel}.\n`;
          }

          let block = `#### 📅 ${dayLabel} Schedule (${slots.length} classes scheduled):\n`;
          for (const s of slots) {
            const facultyName = s.faculty?.name || 'Assigned Faculty';
            const roomResolution = this.resolveRoomDetails(
              s.room,
              allBuildings,
              effectiveLocation,
            );

            // Determine if ongoing, upcoming, or completed based on current hour
            let statusBadge = '';
            if (dayLabel.toLowerCase() === temporal.currentDay.toLowerCase()) {
              if (temporal.currentHourMin >= s.startTime && temporal.currentHourMin <= s.endTime) {
                statusBadge = ' 🟢 **[ONGOING RIGHT NOW]**';
              } else if (temporal.currentHourMin < s.startTime) {
                statusBadge = ' ⏳ **[UPCOMING]**';
              } else {
                statusBadge = ' ✅ *[Completed]*';
              }
            }

            block += `\n* **${s.startTime} - ${s.endTime}**: **${s.subject?.name}**${statusBadge}`;
            block += `\n  - Faculty: ${facultyName}`;
            if (roomResolution) {
              block += `\n  - Location: Room \`${s.room}\` in **${roomResolution.blockName}** (${roomResolution.floor})`;
              block += `\n  - Distance from User: **~${this.formatDistance(roomResolution.distanceMeters)}** (~${roomResolution.walkTimeMinutes} min walk)`;
              block += `\n  - Walking Route: [Open in Google Maps](${roomResolution.directionsUrl})`;
            } else {
              block += `\n  - Room: \`${s.room || 'TBA'}\``;
            }
          }
          return block;
        };

        const todaySlots = timetable[temporal.currentDay] || [];
        const tomorrowSlots = timetable[temporal.tomorrowDay] || [];

        // Always provide Today & Tomorrow
        scheduleContext += formatSlotsWithLocation(todaySlots, `Today (${temporal.currentDay})`);
        scheduleContext += '\n';
        scheduleContext += formatSlotsWithLocation(tomorrowSlots, `Tomorrow (${temporal.tomorrowDay})`);

        // If general timetable query or user asks about other days, include the full weekly matrix
        if (isClassQuery && !isTomorrowQuery) {
          scheduleContext += `\n#### 📋 Complete Weekly Timetable:\n`;
          for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
            const slots = timetable[day] || [];
            if (slots.length > 0) {
              scheduleContext += `* **${day}**: ${slots.map((s: any) => `${s.startTime}-${s.endTime} ${s.subject?.name} (${s.room})`).join(' | ')}\n`;
            }
          }
        }

        contextSections.push(scheduleContext);
      } else {
        // Not enrolled or courses overview
        const allCourses = await this.courseService.getCourses();
        let availableCoursesStr = `### 🎓 University Courses:\n- Student is not enrolled in a course yet. They can enroll via the select-course page.\n- Available Programs: ${allCourses.map((c) => `${c.name} (${c.code})`).join(', ')}`;
        contextSections.push(availableCoursesStr);
      }
    } catch (err) {
      this.logger.warn('Could not retrieve user course/timetable', err);
    }

    // --- Section 3: Specialized Washroom & Restroom Intelligence ---
    if (isWashroomQuery || isFacilityQuery) {
      let washroomContext = `### 🚻 Campus Washroom & Restroom Directory:\n`;
      washroomContext += `* **Standard Layout across LPU**: Every academic block (Block 34, 38, 36, 33, 32, etc.) is equipped with male and female washrooms on **every single floor** directly adjacent to the main elevator lobbies and central stairwells on both East and West wings.\n`;
      washroomContext += `* **Accessible Restrooms**: Dedicated ground-floor accessible washrooms for specially-abled individuals are available in all blocks.\n`;

      if (closestBuilding) {
        washroomContext += `\n👉 **Nearest Washrooms from Student's Current Location**:\n`;
        washroomContext += `1. **${closestBuilding.name} Washrooms** (CLOSEST):
   - Distance: **~${this.formatDistance(closestBuilding.distanceMeters)}** (~${closestBuilding.walkTimeMinutes} min walk).
   - Exact Floor Location: On every floor, right next to the elevator lobbies and main staircases.
   - Walking Route: [Navigate to ${closestBuilding.name} on Google Maps](${closestBuilding.directionsUrl})\n`;

        if (sortedBuildings.length > 1) {
          const secondClosest = sortedBuildings[1];
          washroomContext += `2. **${secondClosest.name} Washrooms** (Alternate):
   - Distance: **~${this.formatDistance(secondClosest.distanceMeters)}** (~${secondClosest.walkTimeMinutes} min walk).
   - Walking Route: [Navigate to ${secondClosest.name} on Google Maps](${secondClosest.directionsUrl})\n`;
        }
      }

      contextSections.push(washroomContext);
    }

    // --- Section 4: Campus Amenities & Facilities (Water, Food, Medical, ATMs) ---
    if (isFacilityQuery && !isWashroomQuery) {
      let facilityKnowledge = `### 🏢 Campus Amenities & Services:\n`;
      facilityKnowledge += `* **Drinking Water**: RO-purified cold water dispensers are installed on every floor of all academic blocks next to the elevators.\n`;
      facilityKnowledge += `* **Food & Dining**:
  - **UniMall (Block 13)**: Central 3-floor dining hub (Subway, Domino's, food court, bakeries, cafes).
  - **Quick Snack Kiosks**: Ground floor of Block 34, Block 38, Block 32, and Block 36.
  - **Mess/Canteens**: Operating in all residential hostel blocks.\n`;
      facilityKnowledge += `* **Banking & ATMs**: SBI and PNB 24/7 ATMs located on the ground floor of UniMall (Block 13) and Block 29 (UniCenter).\n`;
      facilityKnowledge += `* **Printing / Stationery**: UniMall ground floor, Central Library (Block 14), and Block 34 stationery counter.\n`;
      facilityKnowledge += `* **Emergency / Medical (UniHospital)**: 24/7 on-campus hospital with emergency trauma ward, diagnostic lab, ICU, and 24/7 ambulance service. Emergency Contact: \`+91-1824-517000\`.\n`;

      if (closestBuilding) {
        facilityKnowledge += `\n📍 **Closest Academic Block**: **${closestBuilding.name}** (~${this.formatDistance(closestBuilding.distanceMeters)}, ~${closestBuilding.walkTimeMinutes} min walk) - [Walking Route](${closestBuilding.directionsUrl})`;
      }
      contextSections.push(facilityKnowledge);
    }

    // --- Section 5: Campus Buildings & Distance Directory ---
    if (isLocationQuery || (!isClassQuery && !isFacilityQuery && !isFacultyQuery && !isEventQuery)) {
      let bldgContext = `### 📍 Campus Buildings & Distance Directory (Ordered by Proximity):\n`;
      for (const b of sortedBuildings.slice(0, 7)) {
        bldgContext += `* **${b.name}** | Distance: **~${this.formatDistance(b.distanceMeters)}** (~${b.walkTimeMinutes} min walk)\n  - Details: ${b.description || 'Academic block'}\n  - Map Link: [Navigate on Google Maps](${b.directionsUrl})\n`;
      }
      contextSections.push(bldgContext);
    }

    // --- Section 6: Faculty Directory ---
    if (isFacultyQuery || (!isClassQuery && !isLocationQuery && !isFacilityQuery && !isEventQuery)) {
      const faculties = await this.getFaculties();
      let matchedFaculties = faculties;

      if (isFacultyQuery) {
        const filtered = faculties.filter((f) => {
          const lowerName = f.name.toLowerCase().replace('dr.', '').trim();
          const lowerDesig = (f.designation || '').toLowerCase();
          return lowerQuery.includes(lowerName) || lowerQuery.includes(lowerDesig);
        });
        if (filtered.length > 0) {
          matchedFaculties = filtered;
        }
      }

      let facultyContext = `### 👨‍🏫 Faculty Directory:\n`;
      for (const f of matchedFaculties.slice(0, 8)) {
        facultyContext += `* **${f.name}** (${f.designation || 'Faculty'}) | Email: \`${f.email}\` | Phone: \`${f.phone}\`\n`;
      }
      contextSections.push(facultyContext);
    }

    // --- Section 7: Upcoming Campus Events ---
    if (isEventQuery || lowerQuery.includes('what is happening') || lowerQuery.includes('weekend')) {
      const events = await this.getEvents();
      let eventContext = `### 🎉 Upcoming Campus Events:\n`;
      for (const ev of events) {
        const evDate = new Date(ev.time).toLocaleDateString('en-IN', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        eventContext += `* **${ev.name}** (${evDate}) at *${ev.location}*\n  - ${ev.description}\n`;
      }
      contextSections.push(eventContext);
    }

    return contextSections;
  }
}
