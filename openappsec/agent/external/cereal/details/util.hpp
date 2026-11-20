/*! \file util.hpp
    \brief Internal misc utilities
    \ingroup Internal */

#ifndef CEREAL_DETAILS_UTIL_HPP_
#define CEREAL_DETAILS_UTIL_HPP_

#include <typeinfo>
#include <string>

#ifdef _MSC_VER
namespace cereal
{
  namespace util
  {
    //! Demangles the type encoded in a string
    /*! @internal */
    inline std::string demangle( std::string const & name )
    { return name; }

    //! Gets the demangled name of a type
    /*! @internal */
    template <class T> inline
    std::string demangledName()
    { return typeid( T ).name(); }
  } // namespace util
} // namespace cereal
#else // clang or gcc
#include <cxxabi.h>
#include <cstdlib>
namespace cereal
{
  namespace util
  {
    //! Demangles the type encoded in a string
    /*! @internal */
    inline std::string demangle(std::string mangledName)
    {
      int status = 0;
      char *demangledName = nullptr;
      std::size_t len;

      demangledName = abi::__cxa_demangle(mangledName.c_str(), 0, &len, &status);

      std::string retName(demangledName);
      free(demangledName);

      return retName;
    }

    //! Gets the demangled name of a type
    /*! @internal */
    template<class T> inline
    std::string demangledName()
    { return demangle(typeid(T).name()); }
  }
} // namespace cereal
#endif // clang or gcc branch of _MSC_VER
#endif // CEREAL_DETAILS_UTIL_HPP_
