 

#ifndef __I_SHELL_CMD_H__
#define __I_SHELL_CMD_H__

#include <string>
#include <utility>

#include "maybe_res.h"

class I_ShellCmd
{
    using FullOutput = Maybe<std::pair<std::string, int>>;
public:
    virtual Maybe<std::string> getExecOutput(const std::string &cmd, uint ms_tmout = 200, bool do_yield = false) = 0;
    virtual Maybe<int> getExecReturnCode(const std::string &cmd, uint ms_tmout = 200, bool do_yield = false) = 0;
    virtual FullOutput getExecOutputAndCode(const std::string &cmd, uint ms_tmout = 200, bool do_yield = false) = 0;

protected:
    virtual ~I_ShellCmd() {}
};

#endif // __I_SHELL_CMD_H__
