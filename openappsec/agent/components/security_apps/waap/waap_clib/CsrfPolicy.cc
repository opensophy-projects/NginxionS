 

#include "CsrfPolicy.h"
#include "Waf2Util.h"

namespace Waap {
namespace Csrf {

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
