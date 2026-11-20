 

#ifndef __I_SOCKET_IS_H__
#define __I_SOCKET_IS_H__

#include <string.h>
#include <vector>

#include "maybe_res.h"

class I_Socket
{
public:
    enum class SocketType { UNIX, UNIXDG, TCP, UDP };
    using socketFd = int;
    const static socketFd INVALID_SOCKET = -1;

    virtual Maybe<socketFd>
    genSocket(SocketType type, bool is_blocking, bool is_server, const std::string &address) = 0;

    virtual Maybe<socketFd> acceptSocket(
        socketFd server_socket_fd,
        bool is_blocking,
        const std::string &authorized_ip = ""
    ) = 0;

    virtual void closeSocket(socketFd &socket) = 0;
    virtual bool writeData(socketFd socket, const std::vector<char> &data) = 0;
    virtual bool writeDataAsync(socketFd socket, const std::vector<char> &data) = 0;
    virtual Maybe<std::vector<char>> receiveData(socketFd socket, uint data_size, bool is_blocking = true) = 0;
    virtual bool isDataAvailable(socketFd socket) = 0;
    virtual bool isError(socketFd socket) = 0;

protected:
    virtual ~I_Socket() {}
};

#endif // __I_SOCKET_IS_H__
