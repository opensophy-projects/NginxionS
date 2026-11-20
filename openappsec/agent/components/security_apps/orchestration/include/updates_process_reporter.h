 

#ifndef __UPDATES_PROCESS_REPORTER_H__
#define __UPDATES_PROCESS_REPORTER_H__

#include <string>

#include "event.h"
#include "singleton.h"
#include "config.h"
#include "debug.h"
#include "i_orchestration_status.h"
#include "i_service_controller.h"
#include "health_check_status/health_check_status.h"
#include "updates_process_event.h"
#include "updates_process_report.h"

class UpdatesProcessReporter
        :
    public Listener<UpdatesProcessEvent>,
    Singleton::Consume<I_ServiceController>
{
public:
    void upon(const UpdatesProcessEvent &event) override;

private:
    void sendReoprt(const std::string &version);

    static std::vector<UpdatesProcessReport> reports;
    std::map<std::string, uint> report_failure_count_map;
};

#endif // __UPDATES_PROCESS_REPORTER_H__
