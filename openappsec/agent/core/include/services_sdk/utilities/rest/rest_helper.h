 

#ifndef __REST_HELPER_H__
#define __REST_HELPER_H__

namespace RestHelper
{

std::ostream & printIndent(std::ostream &os, uint indent);
void reportError(const std::string &err);

} // RestHelper

#endif // __REST_HELPER_H__
