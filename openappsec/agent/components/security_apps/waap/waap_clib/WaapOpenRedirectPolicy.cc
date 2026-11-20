 

#include "WaapOpenRedirectPolicy.h"
#include "Waf2Util.h"
#include <string>

namespace Waap {
namespace OpenRedirect {

Policy::Policy()
:
enable(false),
enforce(false)
{
}

bool
Policy::operator==(const Policy &other) const
{
    return enable == other.enable &&
        enforce == other.enforce;
}

}
}
