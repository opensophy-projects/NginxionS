 

#ifndef __FIRST_REQUEST_NOTIFICATION_OBJECT_H__
#define __FIRST_REQUEST_NOTIFICATION_OBJECT_H__

#include <string>
#include <ostream>
#include "cereal/archives/json.hpp"
#include "report/report.h"

class FirstRequestNotificationObject
{
public:
    explicit FirstRequestNotificationObject(
        std::string asset_id,
        std::string asset_name,
        ReportIS::Severity severity
    );
    virtual ~FirstRequestNotificationObject();
    void serialize(cereal::JSONOutputArchive& ar) const;

    friend std::ostream& operator<<(std::ostream& os, const FirstRequestNotificationObject& obj);

private:
    std::string toString() const;

    std::string m_asset_id;
    std::string m_asset_name;
    ReportIS::Severity m_severity;
};
#endif
