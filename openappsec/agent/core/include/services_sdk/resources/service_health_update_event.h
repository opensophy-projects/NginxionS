 

#ifndef __SERVICE_HEALTH_UPDATE_EVENT_H__
#define __SERVICE_HEALTH_UPDATE_EVENT_H__

#include "event.h"
#include "singleton.h"
#include "config.h"
#include "debug.h"
#include "customized_cereal_map.h"

class ServiceHealthUpdateEvent : public Event<ServiceHealthUpdateEvent>
{
public:
    ServiceHealthUpdateEvent() {}
    ServiceHealthUpdateEvent(
        const std::string &_component,
        const std::string &_error)
            :
        component(_component),
        error(_error) {}

    bool isHealthyUpdate() const { return component.empty(); }
    const std::string & getComponent() const { return component; }
    const std::string & getError() const { return error; }

private:
    std::string component = "";
    std::string error = "";
};

#endif // __SERVICE_HEALTH_UPDATE_EVENT_H__
