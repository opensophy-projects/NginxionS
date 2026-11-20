 

#include "updates_process_reporter.h"

#include <sstream>
#include <string>

#include "debug.h"
#include "log_generator.h"
#include "service_health_update_event.h"

using namespace std;

USE_DEBUG_FLAG(D_UPDATES_PROCESS_REPORTER);

vector<UpdatesProcessReport> UpdatesProcessReporter::reports;

void
UpdatesProcessReporter::upon(const UpdatesProcessEvent &event)
{
    if (event.getReason() == UpdatesFailureReason::CHECK_UPDATE) {
        auto i_controller = Singleton::Consume<I_ServiceController>::by<UpdatesProcessReporter>();
        string version = i_controller->getUpdatePolicyVersion();
        if (event.getResult() == UpdatesProcessResult::SUCCESS && reports.empty()) {
            dbgTrace(D_UPDATES_PROCESS_REPORTER) << "Update proccess finished successfully";
            report_failure_count_map.erase(version);
            ServiceHealthUpdateEvent().notify();
            return;
        }
        if (report_failure_count_map.find(version) == report_failure_count_map.end()) {
            report_failure_count_map[version] = 0;
        }
        report_failure_count_map[version]++;
        dbgTrace(D_UPDATES_PROCESS_REPORTER)
            << "Update proccess finished with errors. Count: "
            << report_failure_count_map[version];
        if (report_failure_count_map[version] <= 1) {
            reports.clear();
            return;
        }
        reports.emplace_back(
            UpdatesProcessReport(
                event.getResult(),
                event.getType(),
                event.getReason(),
                event.parseDescription()
            )
        );
        sendReoprt(version);
        return;
    }
    if (event.getResult() == UpdatesProcessResult::SUCCESS || event.getResult() == UpdatesProcessResult::UNSET) return;
    reports.emplace_back(
        UpdatesProcessReport(event.getResult(), event.getType(), event.getReason(), event.parseDescription())
    );
    ServiceHealthUpdateEvent(convertUpdatesConfigTypeToStr(event.getType()), event.parseDescription()).notify();
}

void
UpdatesProcessReporter::sendReoprt(const string &version)
{
    stringstream full_reports;
    UpdatesFailureReason failure_reason = UpdatesFailureReason::NONE;
    full_reports << "Updates process reports:" << endl;
    full_reports << "Policy version: " << version << endl;
    full_reports << "report failure count:" << report_failure_count_map[version] << endl;
    for (const auto &report : reports) {
        if (report.getReason() != UpdatesFailureReason::CHECK_UPDATE) {
            failure_reason = report.getReason();
        }
        full_reports << report.toString() << endl;
    }
    reports.clear();
    dbgTrace(D_UPDATES_PROCESS_REPORTER) << "Sending updates process report: " << endl << full_reports.str();
    LogGen log (
        "Updates process report",
        ReportIS::Audience::INTERNAL,
        ReportIS::Severity::HIGH,
        ReportIS::Priority::HIGH,
        ReportIS::Tags::ORCHESTRATOR
    );
    log << LogField("eventMessage", full_reports.str());
    if (failure_reason != UpdatesFailureReason::NONE) {
        log.addToOrigin(LogField("eventCategory", convertUpdatesFailureReasonToStr(failure_reason)));
    }
}
