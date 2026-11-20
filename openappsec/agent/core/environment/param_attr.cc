 

#include "context.h"

bool
EnvKeyAttr::ParamAttr::doesMatch(const EnvKeyAttr::ParamAttr &param) const
{
    if (param.log_section != LogSection::NONE && param.log_section != log_section) return false;
    if (param.verbosity_level != Verbosity::NONE && param.verbosity_level != verbosity_level) return false;

    return true;
}
