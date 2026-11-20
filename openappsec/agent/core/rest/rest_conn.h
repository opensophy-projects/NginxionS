 

#ifndef __REST_CONN_H__
#define __REST_CONN_H__

#include <string>
#include <map>
#include "i_mainloop.h"
#include "i_rest_invoke.h"

class RestConn
{
public:
    RestConn(int _fd, I_MainLoop *_mainloop, const I_RestInvoke *_invoke, bool is_external = false);
    ~RestConn();

    void parseConn() const;

private:
    void stop() const;
    std::string readLine() const;
    std::string readSize(int len) const;
    void sendResponse(const std::string &status, const std::string &body, bool add_newline = true) const;

    int fd;
    I_MainLoop *mainloop;
    const I_RestInvoke *invoke;
    bool is_external_ip = false;
};

#endif // __REST_CONN_H__
