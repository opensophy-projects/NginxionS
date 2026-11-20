/*! \file chrono.hpp
    \brief Support for types found in \<chrono\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_CHRONO_HPP_
#define CEREAL_TYPES_CHRONO_HPP_

#include <chrono>

namespace cereal
{
  //! Saving std::chrono::duration
  template <class Archive, class R, class P> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::chrono::duration<R, P> const & dur )
  {
    ar( CEREAL_NVP_("count", dur.count()) );
  }

  //! Loading std::chrono::duration
  template <class Archive, class R, class P> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::chrono::duration<R, P> & dur )
  {
    R count;
    ar( CEREAL_NVP_("count", count) );

    dur = std::chrono::duration<R, P>{count};
  }

  //! Saving std::chrono::time_point
  template <class Archive, class C, class D> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::chrono::time_point<C, D> const & dur )
  {
    ar( CEREAL_NVP_("time_since_epoch", dur.time_since_epoch()) );
  }

  //! Loading std::chrono::time_point
  template <class Archive, class C, class D> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::chrono::time_point<C, D> & dur )
  {
    D elapsed;
    ar( CEREAL_NVP_("time_since_epoch", elapsed) );

    dur = std::chrono::time_point<C, D>{elapsed};
  }
} // namespace cereal

#endif // CEREAL_TYPES_CHRONO_HPP_
