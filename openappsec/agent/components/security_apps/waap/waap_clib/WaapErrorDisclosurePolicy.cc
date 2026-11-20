 

#include "WaapErrorDisclosurePolicy.h"

namespace Waap {
namespace ErrorDisclosure {

bool
Policy::operator==(const Policy &other) const
{
    return enable == other.enable &&
        enforce == other.enforce;
}

}
}
