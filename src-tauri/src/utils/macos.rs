use std::{
    ops::Deref,
    sync::{Arc, Condvar, Mutex},
};

use anyhow::{anyhow, Result};
use block2::{Block, RcBlock};
use chrono::DateTime;
use objc2::{rc::Retained, runtime::Bool};
use objc2_event_kit::{
    EKAlarm, EKCalendar, EKEntityType, EKEvent, EKEventStore, EKSourceType, EKSpan,
};
use objc2_foundation::{NSArray, NSDate, NSError, NSString, NSURL};

struct ResultState {
    completed: bool,
    success: bool,
    message: String,
}

pub fn add_event(
    title: &str,
    location: &str,
    url: &str,
    start_date: DateTime<chrono::Utc>,
    end_date: DateTime<chrono::Utc>,
) -> Result<()> {
    unsafe {
        let event_store = EKEventStore::new();
        let result_state = Arc::new((
            Mutex::new(ResultState {
                completed: false,
                success: false,
                message: String::new(),
            }),
            Condvar::new(),
        ));
        let result_state_clone = Arc::clone(&result_state);

        event_store.requestFullAccessToEventsWithCompletion(
            RcBlock::new(|granted: Bool, error: *mut NSError| {
                let mut result = result_state_clone.0.lock().unwrap();
                if granted.as_bool() && error.is_null() {
                    let calendars = event_store.calendarsForEntityType(EKEntityType::Event);
                    let mut calendar: Option<Retained<EKCalendar>> = None;
                    for cal in calendars {
                        if cal
                            .title()
                            .isEqualToString(&NSString::from_str("Learning in ZJU"))
                        {
                            calendar = Some(cal);
                            break;
                        }
                    }
                    let calendar = match calendar {
                        Some(cal) => cal,
                        None => {
                            let new_cal = EKCalendar::calendarWithEventStore(&event_store);
                            new_cal.setTitle(&NSString::from_str("Learning in ZJU"));

                            // try to find source "iCloud"
                            let sources = event_store.sources();
                            let mut source: Option<Retained<_>> = None;
                            for s in sources {
                                if s.sourceType() == EKSourceType::CalDAV
                                    && s.title().isEqualToString(&NSString::from_str("iCloud"))
                                {
                                    source = Some(s);
                                    break;
                                }
                            }
                            if let Some(source) = source {
                                new_cal.setSource(Some(&source));
                            } else {
                                match event_store.defaultCalendarForNewEvents() {
                                    Some(default) => new_cal.setSource(default.source().as_deref()),
                                    None => {
                                        result.success = false;
                                        result.message =
                                            "Failed to find source 'iCloud'".to_string();

                                        result.completed = true;
                                        result_state_clone.1.notify_one();
                                        return;
                                    }
                                }
                            }

                            if let Err(e) = event_store.saveCalendar_commit_error(&new_cal, true) {
                                result.success = false;
                                result.message = format!("Failed to save calendar: {:?}", e);
                                result.completed = true;
                                result_state_clone.1.notify_one();
                                return;
                            }
                            new_cal
                        }
                    };

                    let half_year_ago =
                        NSDate::dateWithTimeIntervalSinceNow(-180. * 24. * 60. * 60.);
                    let half_year_later =
                        NSDate::dateWithTimeIntervalSinceNow(180. * 24. * 60. * 60.);
                    let predicate = event_store.predicateForEventsWithStartDate_endDate_calendars(
                        &half_year_ago,
                        &half_year_later,
                        Some(NSArray::from_slice(&[calendar.as_ref()]).as_ref()),
                    );
                    let events = event_store.eventsMatchingPredicate(&predicate);
                    for event in events {
                        if event.title().isEqualToString(&NSString::from_str(&title))
                            && event
                                .location()
                                .unwrap()
                                .isEqualToString(&NSString::from_str(&location))
                            && event
                                .URL()
                                .unwrap()
                                .absoluteString()
                                .unwrap()
                                .isEqualToString(&NSString::from_str(&url))
                        {
                            if event.startDate().isEqualToDate(
                                &NSDate::dateWithTimeIntervalSince1970(
                                    start_date.timestamp_millis() as f64 / 1000.,
                                ),
                            ) && event.endDate().isEqualToDate(
                                &NSDate::dateWithTimeIntervalSince1970(
                                    end_date.timestamp_millis() as f64 / 1000.,
                                ),
                            ) {
                                result.success = false;
                                result.message = "Event already exists".to_string();
                            } else {
                                event.setStartDate(Some(&NSDate::dateWithTimeIntervalSince1970(
                                    start_date.timestamp_millis() as f64 / 1000.,
                                )));
                                event.setEndDate(Some(&NSDate::dateWithTimeIntervalSince1970(
                                    end_date.timestamp_millis() as f64 / 1000.,
                                )));
                                if let Err(e) =
                                    event_store.saveEvent_span_error(&event, EKSpan::ThisEvent)
                                {
                                    result.success = false;
                                    result.message = format!("Failed to update event: {:?}", e);
                                } else {
                                    result.success = true;
                                    result.message = "Event updated successfully".to_string();
                                }
                            }
                            result.completed = true;
                            result_state_clone.1.notify_one();
                            return;
                        }
                    }

                    let event = EKEvent::eventWithEventStore(&event_store);
                    event.setCalendar(Some(&calendar));
                    event.setTitle(Some(&NSString::from_str(&title)));
                    event.setStartDate(Some(&NSDate::dateWithTimeIntervalSince1970(
                        start_date.timestamp_millis() as f64 / 1000.,
                    )));
                    event.setEndDate(Some(&NSDate::dateWithTimeIntervalSince1970(
                        end_date.timestamp_millis() as f64 / 1000.,
                    )));
                    event.setLocation(Some(&NSString::from_str(&location)));
                    event.setURL(NSURL::URLWithString(&NSString::from_str(&url)).as_deref());

                    let alarm = EKAlarm::alarmWithRelativeOffset(-3600.);
                    event.addAlarm(&alarm);

                    if let Err(e) = event_store.saveEvent_span_error(&event, EKSpan::ThisEvent) {
                        result.success = false;
                        result.message = format!("Failed to save event: {:?}", e);
                    } else {
                        result.success = true;
                        result.message = "Event saved successfully".to_string();
                    }
                } else {
                    result.success = false;
                    result.message = format!("Failed to request access to events: {:?}", error);
                }
                result.completed = true;
                result_state_clone.1.notify_one();
            })
            .deref() as *const Block<_> as *mut Block<dyn Fn(Bool, *mut NSError)>,
        );
        let (lock, cvar) = &*result_state;
        let mut result = lock.lock().unwrap();
        while !result.completed {
            result = cvar.wait(result).unwrap();
        }

        if result.success {
            Ok(())
        } else {
            Err(anyhow!("{}", result.message))
        }
    }
}
