 

#ifndef __WAAP_CONVERSIONS_H__
#define __WAAP_CONVERSIONS_H__

#include "WaapEnums.h"
#include "i_waapConfig.h"

namespace Waap {
namespace Conversions {
    ThreatLevel convertFinalScoreToThreatLevel(double finalScore);
    bool shouldDoWafBlocking(const IWaapConfig* const pSitePolicy, ThreatLevel threatLevel);
}
}

#endif // __WAAP_CONVERSIONS_H__
